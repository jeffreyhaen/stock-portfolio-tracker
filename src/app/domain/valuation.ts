import Decimal from 'decimal.js';
import {
    buildImportedFxResolver,
    convertToReportingCurrency,
    convertTransactionToReportingCurrency,
    FxResolver,
} from './fx';
import { buildPriceResolver, PriceProvenance, PriceQuote, ResolvedPrice } from './price-resolution';
import { Transaction, TransactionTypes as T } from './types';

const BUY_TYPES = new Set<string>([T.TradeBuy, T.CorporateBuy]);
const SELL_TYPES = new Set<string>([T.TradeSell, T.CorporateSell]);
const COST_TYPES = new Set<string>([
    T.TransactionFee,
    T.ConnectionFee,
    T.TransactionTax,
    T.ExternalFee,
    T.InterestCharge,
]);
const INCOME_TYPES = new Set<string>([T.Dividend, T.DividendTax, T.CapitalGainDistribution, T.InterestIncome]);
const EXTERNAL_TYPES = new Set<string>([T.Deposit, T.Withdrawal]);

export type QuoteInput = PriceQuote;

export interface ValuationPoint {
    readonly date: string;
    readonly netInvested: Decimal;
    readonly value: Decimal | null;
    readonly complete: boolean;
    readonly missingQuotes: readonly string[];
    readonly missingFx: readonly string[];
    readonly estimatedIsins: readonly string[];
    readonly estimatedFx: readonly string[];
}

export interface PortfolioTotals {
    readonly netInvested: Decimal;
    readonly costs: Decimal;
    readonly income: Decimal;
    readonly incomePerCurrency: ReadonlyMap<string, Decimal>;
    readonly costsPerCurrency: ReadonlyMap<string, Decimal>;
    readonly missingFxIncome: number;
    readonly missingFxCosts: number;
    readonly cash: Decimal;
    readonly value: Decimal | null;
    readonly result: Decimal | null;
    readonly resultPct: Decimal | null;
    readonly complete: boolean;
}

export interface Valuation {
    readonly points: ValuationPoint[];
    readonly totals: PortfolioTotals;
    readonly missingQuotes: string[];
    readonly missingFx: string[];
    readonly estimatedIsins: string[];
    readonly staleIsins: string[];
    readonly priceProvenance: ReadonlyMap<string, PriceProvenance>;
    readonly estimatedFx: string[];
    readonly nonReportingExternalFlows: number;
}

export interface RangeTotals {
    readonly netInvested: Decimal;
    readonly income: Decimal;
    readonly incomePerCurrency: ReadonlyMap<string, Decimal>;
    readonly costs: Decimal;
    readonly costsPerCurrency: ReadonlyMap<string, Decimal>;
    readonly missingFxIncome: number;
    readonly missingFxCosts: number;
    readonly missingFxExternalFlows: number;
    readonly complete: boolean;
}

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || b.rowIndex - a.rowIndex;
}

function convertedMutation(txn: Transaction, fx: FxResolver, reportingCurrency: string, importedFx?: FxResolver) {
    if (txn.mutation === null) return null;
    const currency = txn.mutationCurrency ?? txn.tradeCurrency;
    if (currency === null || currency === '') return null;
    return convertTransactionToReportingCurrency(
        txn.mutation,
        currency,
        txn.date,
        reportingCurrency,
        txn.fxRate,
        importedFx,
        fx,
    );
}

export function rangeTotals(
    transactions: readonly Transaction[],
    fx: FxResolver,
    cutoff: string | null,
    to: string | null = null,
    reportingCurrency = 'EUR',
): RangeTotals {
    let netInvested = new Decimal(0);
    let income = new Decimal(0);
    let costs = new Decimal(0);
    const incomePerCurrency = new Map<string, Decimal>();
    const costsPerCurrency = new Map<string, Decimal>();
    let missingFxIncome = 0;
    let missingFxCosts = 0;
    let missingFxExternalFlows = 0;
    const importedFx = buildImportedFxResolver(transactions, reportingCurrency);

    for (const txn of transactions) {
        if ((cutoff !== null && txn.date < cutoff) || (to !== null && txn.date > to)) continue;
        const conversion = convertedMutation(txn, fx, reportingCurrency, importedFx);
        const converted = conversion?.amount ?? null;
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null) {
            if (converted === null) missingFxExternalFlows++;
            else netInvested = netInvested.plus(converted);
        }
        if (COST_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            costsPerCurrency.set(
                txn.mutationCurrency,
                (costsPerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (converted === null) missingFxCosts++;
            else costs = costs.plus(converted);
        }
        if (INCOME_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            incomePerCurrency.set(
                txn.mutationCurrency,
                (incomePerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (converted === null) missingFxIncome++;
            else income = income.plus(converted);
        }
    }
    return {
        netInvested,
        income,
        incomePerCurrency,
        costs,
        costsPerCurrency,
        missingFxIncome,
        missingFxCosts,
        missingFxExternalFlows,
        complete: missingFxExternalFlows === 0,
    };
}

interface CashAnchor {
    amount: Decimal;
}

interface ValueSnapshot {
    value: Decimal | null;
    cash: Decimal;
    complete: boolean;
    missingQuotes: string[];
    missingFx: string[];
    estimatedIsins: string[];
    estimatedFx: string[];
    staleIsins: string[];
    prices: Map<string, ResolvedPrice>;
}

export function buildValuation(
    transactions: readonly Transaction[],
    quotes: ReadonlyMap<string, QuoteInput>,
    fx: FxResolver,
    today: string,
    reportingCurrency = 'EUR',
): Valuation {
    const sorted = transactions.filter((txn) => txn.date <= today).sort(compareChronological);
    const resolvePrice = buildPriceResolver(sorted, quotes);
    const importedFx = buildImportedFxResolver(sorted, reportingCurrency);
    const positions = new Map<string, Decimal>();
    const points: ValuationPoint[] = [];
    let netInvested = new Decimal(0);
    let costs = new Decimal(0);
    let income = new Decimal(0);
    const incomePerCurrency = new Map<string, Decimal>();
    const costsPerCurrency = new Map<string, Decimal>();
    let missingFxIncome = 0;
    let missingFxCosts = 0;
    const cash = new Map<string, CashAnchor>();
    const missingExternalFx = new Set<string>();
    const estimatedExternalFx = new Set<string>();
    let nonReportingExternalFlows = 0;

    const valueAt = (date: string): ValueSnapshot => {
        let total = new Decimal(0);
        let cashTotal = new Decimal(0);
        let hasValue = cash.size > 0 || positions.size > 0;
        const missingQuotes: string[] = [];
        const missingFx = new Set<string>();
        const estimatedIsins: string[] = [];
        const estimatedFx = new Set<string>();
        const staleIsins: string[] = [];
        const prices = new Map<string, ResolvedPrice>();
        for (const [currency, anchor] of cash) {
            if (anchor.amount.isZero()) continue;
            const converted = convertToReportingCurrency(
                anchor.amount,
                currency,
                date,
                reportingCurrency,
                fx,
                null,
                importedFx,
            );
            if (converted === null) missingFx.add(`${currency}/${reportingCurrency}`);
            else {
                if (converted.provenance === 'imported') estimatedFx.add(`${currency}/${reportingCurrency}`);
                total = total.plus(converted.amount);
                cashTotal = cashTotal.plus(converted.amount);
            }
        }
        for (const [isin, qty] of positions) {
            if (qty.isZero()) continue;
            hasValue = true;
            const resolved = resolvePrice(isin, date);
            if (resolved === null) {
                missingQuotes.push(isin);
                continue;
            }
            prices.set(isin, resolved);
            if (resolved.estimated) estimatedIsins.push(isin);
            if (resolved.stale && !resolved.estimated) staleIsins.push(isin);
            const converted = convertToReportingCurrency(
                qty.times(resolved.price),
                resolved.currency,
                date,
                reportingCurrency,
                fx,
                resolved.transactionFxRate,
                importedFx,
            );
            if (converted === null) missingFx.add(`${resolved.currency}/${reportingCurrency}`);
            else {
                if (converted.provenance === 'imported') {
                    estimatedFx.add(`${resolved.currency}/${reportingCurrency}`);
                }
                total = total.plus(converted.amount);
            }
        }
        for (const pair of missingExternalFx) missingFx.add(pair);
        for (const pair of estimatedExternalFx) estimatedFx.add(pair);
        return {
            value: hasValue ? total : null,
            cash: cashTotal,
            complete: missingQuotes.length === 0 && missingFx.size === 0,
            missingQuotes,
            missingFx: [...missingFx],
            estimatedIsins,
            estimatedFx: [...estimatedFx],
            staleIsins,
            prices,
        };
    };

    let previousDate: string | null = null;
    const pushPoint = (date: string): void => {
        const snapshot = valueAt(date);
        points.push({
            date,
            netInvested,
            value: snapshot.value,
            complete: snapshot.complete,
            missingQuotes: snapshot.missingQuotes,
            missingFx: snapshot.missingFx,
            estimatedIsins: snapshot.estimatedIsins,
            estimatedFx: snapshot.estimatedFx,
        });
    };

    for (const txn of sorted) {
        if (previousDate !== null && txn.date !== previousDate) pushPoint(previousDate);
        previousDate = txn.date;
        if (txn.isin !== null && txn.quantity !== null) {
            const current = positions.get(txn.isin) ?? new Decimal(0);
            if (BUY_TYPES.has(txn.type)) positions.set(txn.isin, current.plus(txn.quantity));
            else if (SELL_TYPES.has(txn.type)) {
                positions.set(txn.isin, Decimal.max(current.minus(txn.quantity), new Decimal(0)));
            }
        }
        const conversion = convertedMutation(txn, fx, reportingCurrency, importedFx);
        const converted = conversion?.amount ?? null;
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null) {
            if (converted === null) {
                nonReportingExternalFlows++;
                const currency = txn.mutationCurrency ?? txn.tradeCurrency;
                if (currency !== null) missingExternalFx.add(`${currency}/${reportingCurrency}`);
            } else {
                netInvested = netInvested.plus(converted);
                if (conversion?.provenance === 'imported') {
                    const currency = txn.mutationCurrency ?? txn.tradeCurrency;
                    if (currency !== null) estimatedExternalFx.add(`${currency}/${reportingCurrency}`);
                }
            }
        }
        if (COST_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            costsPerCurrency.set(
                txn.mutationCurrency,
                (costsPerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (converted === null) missingFxCosts++;
            else costs = costs.plus(converted);
        }
        if (INCOME_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            incomePerCurrency.set(
                txn.mutationCurrency,
                (incomePerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (converted === null) missingFxIncome++;
            else income = income.plus(converted);
        }
        if (txn.balanceCurrency !== null && txn.balance !== null) {
            cash.set(txn.balanceCurrency, { amount: txn.balance });
        }
    }
    if (previousDate !== null) {
        pushPoint(previousDate);
        if (today > previousDate) pushPoint(today);
    }

    const latestSnapshot = valueAt(today);
    const value = latestSnapshot.value;
    const complete = latestSnapshot.complete && nonReportingExternalFlows === 0;
    const result = value === null || !complete ? null : value.minus(netInvested);
    const resultPct = result === null || netInvested.isZero() ? null : result.div(netInvested).times(100);
    return {
        points,
        totals: {
            netInvested,
            costs,
            income,
            incomePerCurrency,
            costsPerCurrency,
            missingFxIncome,
            missingFxCosts,
            cash: latestSnapshot.cash,
            value,
            result,
            resultPct,
            complete,
        },
        missingQuotes: latestSnapshot.missingQuotes,
        missingFx: latestSnapshot.missingFx,
        estimatedIsins: latestSnapshot.estimatedIsins,
        staleIsins: latestSnapshot.staleIsins,
        priceProvenance: new Map([...latestSnapshot.prices].map(([isin, price]) => [isin, price.provenance])),
        estimatedFx: latestSnapshot.estimatedFx,
        nonReportingExternalFlows,
    };
}
