import Decimal from 'decimal.js';
import {
    buildImportedFxResolver,
    convertToReportingCurrency,
    convertTransactionToReportingCurrency,
    FxResolver,
} from './fx';
import { buildPriceResolver } from './price-resolution';
import { Transaction, TransactionTypes as T } from './types';

const BUY_TYPES = new Set<string>([T.TradeBuy, T.CorporateBuy]);
const SELL_TYPES = new Set<string>([T.TradeSell, T.CorporateSell]);
const EXTERNAL_TYPES = new Set<string>([T.Deposit, T.Withdrawal]);

export interface PriceBar {
    readonly date: string;
    readonly close: Decimal;
    readonly currency: string;
}

export interface MarketValuePoint {
    readonly date: string;
    readonly value: Decimal | null;
    readonly flow: Decimal;
    readonly netInvested: Decimal;
    readonly complete: boolean;
}

export interface MarketValueSeries {
    readonly points: MarketValuePoint[];
    readonly missingFx: string[];
    readonly estimatedIsins: string[];
    readonly estimatedFx: string[];
    readonly missingExternalFlows: number;
    readonly complete: boolean;
}

interface TradeEvent {
    readonly date: string;
    readonly isin: string;
    readonly delta: Decimal;
}

interface CashEvent {
    readonly date: string;
    readonly currency: string;
    readonly balance: Decimal;
}

interface FlowEvent {
    readonly date: string;
    readonly currency: string;
    readonly convertedAmount: Decimal | null;
    readonly estimated: boolean;
}

export interface SplitFactor {
    readonly date: string;
    readonly factor: Decimal;
}

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || b.rowIndex - a.rowIndex;
}

export function buildMarketValueSeries(
    transactions: readonly Transaction[],
    bars: ReadonlyMap<string, readonly PriceBar[]>,
    fx: FxResolver,
    splits: ReadonlyMap<string, readonly SplitFactor[]> = new Map(),
    reportingCurrency = 'EUR',
): MarketValueSeries {
    const sorted = [...transactions].sort(compareChronological);
    const trades: TradeEvent[] = [];
    const resolveTradePrice = buildPriceResolver(sorted, new Map());
    const importedFx = buildImportedFxResolver(sorted, reportingCurrency);
    const cashEvents: CashEvent[] = [];
    const flows: FlowEvent[] = [];
    const netInvestedEvents: {
        date: string;
        amount: Decimal | null;
        missingPair: string | null;
        estimatedPair: string | null;
    }[] = [];
    const splitActionDates = new Map<string, Set<string>>();

    for (const txn of sorted) {
        if (txn.isin !== null && txn.corporateAction === 'STOCK_SPLIT') {
            const dates = splitActionDates.get(txn.isin) ?? new Set<string>();
            dates.add(txn.date);
            splitActionDates.set(txn.isin, dates);
        }
        if (txn.isin !== null && txn.quantity !== null) {
            if (BUY_TYPES.has(txn.type)) {
                trades.push({ date: txn.date, isin: txn.isin, delta: txn.quantity });
            } else if (SELL_TYPES.has(txn.type)) {
                trades.push({ date: txn.date, isin: txn.isin, delta: txn.quantity.negated() });
            }
        }
        if (txn.balanceCurrency !== null && txn.balance !== null) {
            cashEvents.push({ date: txn.date, currency: txn.balanceCurrency, balance: txn.balance });
        }
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            const converted = convertTransactionToReportingCurrency(
                txn.mutation,
                txn.mutationCurrency,
                txn.date,
                reportingCurrency,
                txn.fxRate,
                importedFx,
                fx,
            );
            flows.push({
                date: txn.date,
                currency: txn.mutationCurrency,
                convertedAmount: converted?.amount ?? null,
                estimated: converted?.provenance === 'imported',
            });
            netInvestedEvents.push({
                date: txn.date,
                amount: converted?.amount ?? null,
                missingPair: converted === null ? `${txn.mutationCurrency}/${reportingCurrency}` : null,
                estimatedPair:
                    converted?.provenance === 'imported'
                        ? `${txn.mutationCurrency}/${reportingCurrency}`
                        : null,
            });
        }
    }

    const tradesPerIsin = new Map<string, TradeEvent[]>();
    for (const trade of trades) {
        const list = tradesPerIsin.get(trade.isin) ?? [];
        list.push(trade);
        tradesPerIsin.set(trade.isin, list);
    }

    const days = new Set<string>();
    for (const list of bars.values()) {
        for (const bar of list) {
            days.add(bar.date);
        }
    }
    const sortedDays = [...days].sort();
    const missingFx = new Set<string>();
    const points: MarketValuePoint[] = [];
    const firstRelevantDate = earliestRelevantDate(sorted);

    const priceState = new Map<string, { index: number; latest: PriceBar | null }>();
    for (const isin of bars.keys()) {
        priceState.set(isin, { index: 0, latest: null });
    }
    const estimatedIsins = new Set<string>();
    const estimatedFx = new Set<string>();
    const qtyState = new Map<string, { index: number; qty: Decimal }>();
    for (const isin of tradesPerIsin.keys()) {
        qtyState.set(isin, { index: 0, qty: new Decimal(0) });
    }
    let cashIndex = 0;
    const cash = new Map<string, Decimal>();
    let netInvestedIndex = 0;
    let netInvested = new Decimal(0);
    let missingExternalFlowsToDate = 0;
    const missingExternalFlows = netInvestedEvents.filter((event) => event.amount === null).length;
    for (const event of netInvestedEvents) {
        if (event.missingPair !== null) missingFx.add(event.missingPair);
    }

    for (const day of sortedDays) {
        if (day < firstRelevantDate) {
            continue;
        }
        while (cashIndex < cashEvents.length && cashEvents[cashIndex].date <= day) {
            cash.set(cashEvents[cashIndex].currency, cashEvents[cashIndex].balance);
            cashIndex++;
        }
        while (netInvestedIndex < netInvestedEvents.length && netInvestedEvents[netInvestedIndex].date <= day) {
            const event = netInvestedEvents[netInvestedIndex];
            if (event.amount === null) {
                missingExternalFlowsToDate++;
                if (event.missingPair !== null) missingFx.add(event.missingPair);
            } else netInvested = netInvested.plus(event.amount);
            if (event.estimatedPair !== null) estimatedFx.add(event.estimatedPair);
            netInvestedIndex++;
        }
        for (const [isin, state] of qtyState) {
            const list = tradesPerIsin.get(isin) ?? [];
            while (state.index < list.length && list[state.index].date <= day) {
                state.qty = Decimal.max(state.qty.plus(list[state.index].delta), new Decimal(0));
                state.index++;
            }
        }
        for (const [isin, state] of priceState) {
            const list = bars.get(isin) ?? [];
            while (state.index < list.length && list[state.index].date <= day) {
                state.latest = list[state.index];
                state.index++;
            }
        }
        let total = new Decimal(0);
        let complete = missingExternalFlowsToDate === 0;
        for (const [currency, amount] of cash) {
            if (amount.isZero()) continue;
            const converted = convertToReportingCurrency(
                amount,
                currency,
                day,
                reportingCurrency,
                fx,
                null,
                importedFx,
            );
            if (converted === null) {
                missingFx.add(`${currency}/${reportingCurrency}`);
                complete = false;
                break;
            }
            if (converted.provenance === 'imported') estimatedFx.add(`${currency}/${reportingCurrency}`);
            total = total.plus(converted.amount);
        }
        if (!complete) {
            points.push({
                date: day,
                value: null,
                flow: flowOn(day),
                netInvested,
                complete: false,
            });
            continue;
        }
        for (const [isin, qtyInfo] of qtyState) {
            const qty = qtyInfo.qty;
            if (qty.isZero()) {
                continue;
            }
            const bar = priceState.get(isin)?.latest ?? null;
            let price: Decimal;
            let currency: string;
            let quantity = qty;
            let transactionFxRate: Decimal | null = null;
            if (bar !== null) {
                price = bar.close;
                currency = bar.currency;
                for (const split of splits.get(isin) ?? []) {
                    const splitActionOnSameDay = splitActionDates.get(isin)?.has(split.date) ?? false;
                    if (split.date > day || (split.date === day && !splitActionOnSameDay)) {
                        quantity = quantity.times(split.factor);
                    }
                }
            } else {
                const fallback = resolveTradePrice(isin, day);
                if (fallback === null) {
                    complete = false;
                    break;
                }
                price = fallback.price;
                currency = fallback.currency;
                transactionFxRate = fallback.transactionFxRate;
                estimatedIsins.add(isin);
            }
            const converted = convertToReportingCurrency(
                quantity.times(price),
                currency,
                day,
                reportingCurrency,
                fx,
                transactionFxRate,
                importedFx,
            );
            if (converted === null) {
                missingFx.add(`${currency}/${reportingCurrency}`);
                complete = false;
                break;
            }
            if (converted.provenance === 'imported') estimatedFx.add(`${currency}/${reportingCurrency}`);
            total = total.plus(converted.amount);
        }
        points.push({
            date: day,
            value: complete ? total : null,
            flow: flowOn(day),
            netInvested,
            complete,
        });
    }

    function flowOn(day: string): Decimal {
        let sum = new Decimal(0);
        for (const flow of flows) {
            if (flow.date !== day) {
                continue;
            }
            if (flow.convertedAmount !== null) {
                if (flow.estimated) estimatedFx.add(`${flow.currency}/${reportingCurrency}`);
                sum = sum.plus(flow.convertedAmount);
            }
        }
        return sum;
    }

    return {
        points,
        missingFx: [...missingFx],
        estimatedIsins: [...estimatedIsins],
        estimatedFx: [...estimatedFx],
        missingExternalFlows,
        complete: missingExternalFlows === 0 && points.every((point) => point.complete),
    };
}

function earliestRelevantDate(transactions: readonly Transaction[]): string {
    let min = '';
    for (const txn of transactions) {
        if (min === '' || txn.date < min) {
            min = txn.date;
        }
    }
    return min;
}
