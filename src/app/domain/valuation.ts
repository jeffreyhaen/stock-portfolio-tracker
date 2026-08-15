import Decimal from 'decimal.js';
import { FxResolver } from './fx';
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

export interface QuoteInput {
    readonly price: Decimal;
    readonly currency: string;
}

export interface ValuationPoint {
    readonly date: string;
    readonly netInvested: Decimal;
    readonly value: Decimal | null;
}

export interface PortfolioTotals {
    readonly netInvested: Decimal;
    readonly costs: Decimal;
    readonly income: Decimal;
    readonly incomePerCurrency: ReadonlyMap<string, Decimal>;
    readonly costsPerCurrency: ReadonlyMap<string, Decimal>;
    readonly missingFxIncome: number;
    readonly missingFxCosts: number;
    readonly cashEur: Decimal;
    readonly value: Decimal | null;
    readonly result: Decimal | null;
    readonly resultPct: Decimal | null;
}

export interface Valuation {
    readonly points: ValuationPoint[];
    readonly totals: PortfolioTotals;
    readonly missingQuotes: string[];
    readonly missingFx: string[];
    readonly nonEurExternalFlows: number;
}

export interface RangeTotals {
    readonly netInvested: Decimal;
    readonly income: Decimal;
    readonly incomePerCurrency: ReadonlyMap<string, Decimal>;
    readonly costs: Decimal;
    readonly costsPerCurrency: ReadonlyMap<string, Decimal>;
    readonly missingFxIncome: number;
    readonly missingFxCosts: number;
}

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex;
}

export function rangeTotals(
    transactions: readonly Transaction[],
    fx: FxResolver,
    cutoff: string | null,
    to: string | null = null,
): RangeTotals {
    let netInvested = new Decimal(0);
    let income = new Decimal(0);
    let costs = new Decimal(0);
    const incomePerCurrency = new Map<string, Decimal>();
    const costsPerCurrency = new Map<string, Decimal>();
    let missingFxIncome = 0;
    let missingFxCosts = 0;

    for (const txn of transactions) {
        if (cutoff !== null && txn.date < cutoff) {
            continue;
        }
        if (to !== null && txn.date > to) {
            continue;
        }
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency === 'EUR') {
            netInvested = netInvested.plus(txn.mutation);
        }
        if (COST_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            costsPerCurrency.set(
                txn.mutationCurrency,
                (costsPerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (txn.mutationCurrency === 'EUR') {
                costs = costs.plus(txn.mutation);
            } else {
                const rate = fx(txn.mutationCurrency, txn.date);
                if (rate !== null) {
                    costs = costs.plus(txn.mutation.times(rate));
                } else {
                    missingFxCosts++;
                }
            }
        }
        if (INCOME_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            incomePerCurrency.set(
                txn.mutationCurrency,
                (incomePerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (txn.mutationCurrency === 'EUR') {
                income = income.plus(txn.mutation);
            } else {
                const rate = fx(txn.mutationCurrency, txn.date);
                if (rate !== null) {
                    income = income.plus(txn.mutation.times(rate));
                } else {
                    missingFxIncome++;
                }
            }
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
    };
}

export function buildValuation(
    transactions: readonly Transaction[],
    quotes: ReadonlyMap<string, QuoteInput>,
    fx: FxResolver,
    today: string,
): Valuation {
    const sorted = [...transactions].sort(compareChronological);
    const positions = new Map<string, Decimal>();
    const points: ValuationPoint[] = [];
    let netInvested = new Decimal(0);
    let costs = new Decimal(0);
    let income = new Decimal(0);
    const incomePerCurrency = new Map<string, Decimal>();
    const costsPerCurrency = new Map<string, Decimal>();
    let missingFxIncome = 0;
    let missingFxCosts = 0;
    let cashEur = new Decimal(0);
    let nonEurExternalFlows = 0;

    const valueAt = (date: string): Decimal | null => {
        let total = cashEur;
        for (const [isin, qty] of positions) {
            if (qty.isZero()) {
                continue;
            }
            const quote = quotes.get(isin);
            if (quote === undefined) {
                return null;
            }
            const rate = fx(quote.currency, date);
            if (rate === null) {
                return null;
            }
            total = total.plus(qty.times(quote.price).times(rate));
        }
        return total;
    };

    let previousDate: string | null = null;
    const pushPoint = (date: string): void => {
        points.push({ date, netInvested, value: valueAt(date) });
    };

    for (const txn of sorted) {
        if (previousDate !== null && txn.date !== previousDate) {
            pushPoint(previousDate);
        }
        previousDate = txn.date;
        if (txn.isin !== null && txn.quantity !== null) {
            if (BUY_TYPES.has(txn.type)) {
                positions.set(txn.isin, (positions.get(txn.isin) ?? new Decimal(0)).plus(txn.quantity));
            } else if (SELL_TYPES.has(txn.type)) {
                positions.set(txn.isin, (positions.get(txn.isin) ?? new Decimal(0)).minus(txn.quantity));
            }
        }
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null) {
            if (txn.mutationCurrency === 'EUR') {
                netInvested = netInvested.plus(txn.mutation);
            } else {
                nonEurExternalFlows += 1;
            }
        }
        if (COST_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            costsPerCurrency.set(
                txn.mutationCurrency,
                (costsPerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (txn.mutationCurrency === 'EUR') {
                costs = costs.plus(txn.mutation);
            } else {
                const rate = fx(txn.mutationCurrency, txn.date);
                if (rate !== null) {
                    costs = costs.plus(txn.mutation.times(rate));
                } else {
                    missingFxCosts++;
                }
            }
        }
        if (INCOME_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency !== null) {
            incomePerCurrency.set(
                txn.mutationCurrency,
                (incomePerCurrency.get(txn.mutationCurrency) ?? new Decimal(0)).plus(txn.mutation),
            );
            if (txn.mutationCurrency === 'EUR') {
                income = income.plus(txn.mutation);
            } else {
                const rate = fx(txn.mutationCurrency, txn.date);
                if (rate !== null) {
                    income = income.plus(txn.mutation.times(rate));
                } else {
                    missingFxIncome++;
                }
            }
        }
        if (txn.balanceCurrency === 'EUR' && txn.balance !== null) {
            cashEur = txn.balance;
        }
    }
    if (previousDate !== null) {
        pushPoint(previousDate);
        if (today > previousDate) {
            points.push({ date: today, netInvested, value: valueAt(today) });
        }
    }

    const missingQuotes: string[] = [];
    const missingFx = new Set<string>();
    for (const [isin, qty] of positions) {
        if (qty.isZero()) {
            continue;
        }
        const quote = quotes.get(isin);
        if (quote === undefined) {
            missingQuotes.push(isin);
        } else if (fx(quote.currency, today) === null) {
            missingFx.add(`${quote.currency}/EUR`);
        }
    }

    const latest = points.length > 0 ? points[points.length - 1] : null;
    const value = latest?.value ?? null;
    const result = value === null ? null : value.minus(netInvested);
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
            cashEur,
            value,
            result,
            resultPct,
        },
        missingQuotes,
        missingFx: [...missingFx],
        nonEurExternalFlows,
    };
}
