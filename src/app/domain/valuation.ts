import Decimal from 'decimal.js';
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

export interface ValuationPoint {
    readonly datum: string;
    readonly netInvested: Decimal;
    readonly value: Decimal | null;
}

export interface PortfolioTotals {
    readonly netInvested: Decimal;
    readonly costs: Decimal;
    readonly income: Decimal;
    readonly cashEur: Decimal;
    readonly value: Decimal | null;
    readonly result: Decimal | null;
    readonly resultPct: Decimal | null;
}

export interface Valuation {
    readonly punten: ValuationPoint[];
    readonly totals: PortfolioTotals;
    readonly ontbrekendQuotes: string[];
    readonly nietEurExterneFlows: number;
}

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex;
}

export function buildValuation(
    transactions: readonly Transaction[],
    quotes: ReadonlyMap<string, Decimal>,
    today: string,
): Valuation {
    const gesorteerd = [...transactions].sort(compareChronological);
    const posities = new Map<string, Decimal>();
    const punten: ValuationPoint[] = [];
    let netInvested = new Decimal(0);
    let costs = new Decimal(0);
    let income = new Decimal(0);
    let cashEur = new Decimal(0);
    let nietEurExterneFlows = 0;

    const valueOp = (): Decimal | null => {
        let totaal = cashEur;
        for (const [isin, qty] of posities) {
            if (qty.isZero()) {
                continue;
            }
            const quote = quotes.get(isin);
            if (quote === undefined) {
                return null;
            }
            totaal = totaal.plus(qty.times(quote));
        }
        return totaal;
    };

    let vorigeDatum: string | null = null;
    const pushPunt = (datum: string): void => {
        punten.push({ datum, netInvested, value: valueOp() });
    };

    for (const txn of gesorteerd) {
        if (vorigeDatum !== null && txn.date !== vorigeDatum) {
            pushPunt(vorigeDatum);
        }
        vorigeDatum = txn.date;
        if (txn.isin !== null && txn.quantity !== null) {
            if (BUY_TYPES.has(txn.type)) {
                posities.set(txn.isin, (posities.get(txn.isin) ?? new Decimal(0)).plus(txn.quantity));
            } else if (SELL_TYPES.has(txn.type)) {
                posities.set(txn.isin, (posities.get(txn.isin) ?? new Decimal(0)).minus(txn.quantity));
            }
        }
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null) {
            if (txn.mutationCurrency === 'EUR') {
                netInvested = netInvested.plus(txn.mutation);
            } else {
                nietEurExterneFlows += 1;
            }
        }
        if (COST_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency === 'EUR') {
            costs = costs.plus(txn.mutation.abs());
        }
        if (INCOME_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency === 'EUR') {
            income = income.plus(txn.mutation);
        }
        if (txn.balanceCurrency === 'EUR' && txn.balance !== null) {
            cashEur = txn.balance;
        }
    }
    if (vorigeDatum !== null) {
        pushPunt(vorigeDatum);
        if (today > vorigeDatum) {
            punten.push({ datum: today, netInvested, value: valueOp() });
        }
    }

    const ontbrekendQuotes: string[] = [];
    for (const [isin, qty] of posities) {
        if (!qty.isZero() && !quotes.has(isin)) {
            ontbrekendQuotes.push(isin);
        }
    }

    const laatste = punten.length > 0 ? punten[punten.length - 1] : null;
    const value = laatste?.value ?? null;
    const result = value === null ? null : value.minus(netInvested);
    const resultPct = result === null || netInvested.isZero() ? null : result.div(netInvested).times(100);

    return {
        punten,
        totals: { netInvested, costs, income, cashEur, value, result, resultPct },
        ontbrekendQuotes,
        nietEurExterneFlows,
    };
}
