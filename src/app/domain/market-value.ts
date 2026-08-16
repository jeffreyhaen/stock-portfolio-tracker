import Decimal from 'decimal.js';
import { FxResolver } from './fx';
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
}

export interface MarketValueSeries {
    readonly points: MarketValuePoint[];
    readonly missingFx: string[];
    readonly estimatedIsins: string[];
}

interface AnchorEvent {
    readonly date: string;
    readonly price: Decimal;
    readonly currency: string;
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
    readonly amount: Decimal;
}

export interface SplitFactor {
    readonly date: string;
    readonly factor: Decimal;
}

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex;
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
    const anchors = new Map<string, AnchorEvent[]>();
    const cashEvents: CashEvent[] = [];
    const flows: FlowEvent[] = [];
    let totalNetInvested = new Decimal(0);
    const netInvestedEvents: FlowEvent[] = [];

    for (const txn of sorted) {
        if (txn.isin !== null && txn.quantity !== null) {
            if (BUY_TYPES.has(txn.type)) {
                trades.push({ date: txn.date, isin: txn.isin, delta: txn.quantity });
            } else if (SELL_TYPES.has(txn.type)) {
                trades.push({ date: txn.date, isin: txn.isin, delta: txn.quantity.negated() });
            }
            if (
                (BUY_TYPES.has(txn.type) || SELL_TYPES.has(txn.type)) &&
                txn.price !== null &&
                txn.tradeCurrency !== null
            ) {
                const list = anchors.get(txn.isin) ?? [];
                list.push({ date: txn.date, price: txn.price, currency: txn.tradeCurrency });
                anchors.set(txn.isin, list);
            }
        }
        if (txn.balanceCurrency !== null && txn.balance !== null) {
            if (txn.balanceCurrency === reportingCurrency || reportingCurrency !== 'EUR') {
                cashEvents.push({ date: txn.date, currency: txn.balanceCurrency, balance: txn.balance });
            }
        }
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            flows.push({ date: txn.date, currency: txn.mutationCurrency, amount: txn.mutation });
            if (txn.mutationCurrency === reportingCurrency) {
                totalNetInvested = totalNetInvested.plus(txn.mutation);
                netInvestedEvents.push({ date: txn.date, currency: reportingCurrency, amount: totalNetInvested });
            }
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
    const anchorState = new Map<string, { index: number; latest: AnchorEvent | null }>();
    for (const isin of anchors.keys()) {
        anchorState.set(isin, { index: 0, latest: null });
    }
    const estimatedIsins = new Set<string>();
    const qtyState = new Map<string, { index: number; qty: Decimal }>();
    for (const isin of tradesPerIsin.keys()) {
        qtyState.set(isin, { index: 0, qty: new Decimal(0) });
    }
    let cashIndex = 0;
    const cash = new Map<string, Decimal>();
    let netInvestedIndex = 0;
    let netInvested = new Decimal(0);

    for (const day of sortedDays) {
        if (day < firstRelevantDate) {
            continue;
        }
        while (cashIndex < cashEvents.length && cashEvents[cashIndex].date <= day) {
            cash.set(cashEvents[cashIndex].currency, cashEvents[cashIndex].balance);
            cashIndex++;
        }
        while (netInvestedIndex < netInvestedEvents.length && netInvestedEvents[netInvestedIndex].date <= day) {
            netInvested = netInvestedEvents[netInvestedIndex].amount;
            netInvestedIndex++;
        }
        for (const [isin, state] of qtyState) {
            const list = tradesPerIsin.get(isin) ?? [];
            while (state.index < list.length && list[state.index].date <= day) {
                state.qty = state.qty.plus(list[state.index].delta);
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
        for (const [isin, state] of anchorState) {
            const list = anchors.get(isin) ?? [];
            while (state.index < list.length && list[state.index].date <= day) {
                state.latest = list[state.index];
                state.index++;
            }
        }
        let total = new Decimal(0);
        let complete = true;
        for (const [currency, amount] of cash) {
            if (amount.isZero()) {
                continue;
            }
            const rate = fx(currency, day);
            if (rate === null) {
                missingFx.add(`${currency}/${reportingCurrency}`);
                complete = false;
                break;
            }
            total = total.plus(amount.times(rate));
        }
        if (!complete) {
            points.push({
                date: day,
                value: null,
                flow: flowOn(day),
                netInvested,
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
            if (bar !== null) {
                price = bar.close;
                currency = bar.currency;
                for (const split of splits.get(isin) ?? []) {
                    if (split.date > day) {
                        quantity = quantity.times(split.factor);
                    }
                }
            } else {
                const anchor = anchorState.get(isin)?.latest ?? null;
                if (anchor === null) {
                    complete = false;
                    break;
                }
                price = anchor.price;
                currency = anchor.currency;
                estimatedIsins.add(isin);
            }
            const rate = fx(currency, day);
            if (rate === null) {
                missingFx.add(`${currency}/${reportingCurrency}`);
                complete = false;
                break;
            }
            total = total.plus(quantity.times(price).times(rate));
        }
        points.push({
            date: day,
            value: complete ? total : null,
            flow: flowOn(day),
            netInvested,
        });
    }

    function flowOn(day: string): Decimal {
        let sum = new Decimal(0);
        for (const flow of flows) {
            if (flow.date !== day) {
                continue;
            }
            if (flow.currency === reportingCurrency) {
                sum = sum.plus(flow.amount);
                continue;
            }
            const rate = fx(flow.currency, day);
            if (rate !== null) {
                sum = sum.plus(flow.amount.times(rate));
            }
        }
        return sum;
    }

    return { points, missingFx: [...missingFx], estimatedIsins: [...estimatedIsins] };
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
