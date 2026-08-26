import Decimal from 'decimal.js';
import { FxResolver, mutationInReportingCurrency } from './fx';
import { Transaction, TransactionTypes as T } from './types';

export interface Cashflow {
    readonly date: string;
    readonly amount: Decimal;
}

const MIN_RETURN = -0.9999;
const MAX_RETURN = 100;
const BISECTIE_ITERATIES = 100;
const DAGEN_PER_JAAR = 365;

export function xirr(flows: readonly Cashflow[]): Decimal | null {
    const hasInflow = flows.some((f) => f.amount.isPositive() && !f.amount.isZero());
    const hasOutflow = flows.some((f) => f.amount.isNegative() && !f.amount.isZero());
    if (!hasInflow || !hasOutflow) {
        return null;
    }
    const t0 = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0].date);
    const points = flows.map((f) => ({
        years: daysBetween(t0, f.date) / DAGEN_PER_JAAR,
        amount: f.amount.toNumber(),
    }));
    const npv = (r: number): number => {
        let sum = 0;
        for (const p of points) {
            sum += p.amount / Math.pow(1 + r, p.years);
        }
        return sum;
    };
    let lo = MIN_RETURN;
    let hi = MAX_RETURN;
    const fLo = npv(lo);
    const fHi = npv(hi);
    if (fLo === 0) {
        return new Decimal(lo);
    }
    if (fHi === 0) {
        return new Decimal(hi);
    }
    if (fLo > 0 === fHi > 0) {
        return null;
    }
    for (let i = 0; i < BISECTIE_ITERATIES; i++) {
        const mid = (lo + hi) / 2;
        const fMid = npv(mid);
        if (fMid === 0 || hi - lo < 1e-12) {
            break;
        }
        if (fMid > 0 === fLo > 0) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return new Decimal((lo + hi) / 2);
}

export interface CashflowOptions {
    readonly reportingCurrency?: string;
    readonly fxFallback?: FxResolver;
}

export function cashflowsPerIsin(
    transactions: readonly Transaction[],
    options: CashflowOptions = {},
): Map<string, Cashflow[] | null> {
    const { reportingCurrency = 'EUR', fxFallback } = options;
    const perIsin = new Map<string, Cashflow[] | null>();
    for (const txn of transactions) {
        if (txn.isin === null || txn.mutation === null) {
            continue;
        }
        let flows = perIsin.get(txn.isin);
        if (flows === undefined) {
            flows = [];
            perIsin.set(txn.isin, flows);
        }
        if (flows === null) {
            continue;
        }
        const amount = mutationInReportingCurrency(txn, reportingCurrency, fxFallback);
        if (amount === null) {
            perIsin.set(txn.isin, null);
            continue;
        }
        flows.push({ date: txn.date, amount });
    }
    return perIsin;
}

export function holdingCashflows(
    transactions: readonly Transaction[],
    isin: string,
    options: CashflowOptions = {},
): Cashflow[] | null {
    const { reportingCurrency = 'EUR', fxFallback } = options;
    const flows: Cashflow[] = [];
    for (const txn of transactions) {
        if (txn.isin !== isin || txn.mutation === null) {
            continue;
        }
        const amount = mutationInReportingCurrency(txn, reportingCurrency, fxFallback);
        if (amount === null) {
            return null;
        }
        flows.push({ date: txn.date, amount });
    }
    return flows;
}

const EXTERNAL_TYPES = new Set<string>([T.Deposit, T.Withdrawal]);

export function portfolioCashflows(
    transactions: readonly Transaction[],
    options: CashflowOptions = {},
): Cashflow[] | null {
    const { reportingCurrency = 'EUR', fxFallback } = options;
    const flows: Cashflow[] = [];
    for (const txn of transactions) {
        if (!EXTERNAL_TYPES.has(txn.type) || txn.mutation === null) {
            continue;
        }
        const amount = mutationInReportingCurrency(txn, reportingCurrency, fxFallback);
        if (amount === null) {
            return null;
        }
        flows.push({ date: txn.date, amount: amount.neg() });
    }
    return flows;
}

export function moneyWeightedTotalReturn(flows: readonly Cashflow[]): Decimal | null {
    const hasInflow = flows.some((f) => f.amount.isPositive() && !f.amount.isZero());
    const hasOutflow = flows.some((f) => f.amount.isNegative() && !f.amount.isZero());
    if (!hasInflow || !hasOutflow) {
        return null;
    }
    const window = cashflowWindowDays(flows);
    if (window === 0) {
        return null;
    }
    const t0 = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0].date);
    const points = flows.map((f) => ({ fraction: daysBetween(t0, f.date) / window, amount: f.amount.toNumber() }));
    const npv = (growth: number): number => {
        let sum = 0;
        for (const p of points) {
            sum += p.amount / Math.pow(1 + growth, p.fraction);
        }
        return sum;
    };
    let lo = MIN_RETURN;
    let hi = 1e6;
    if (npv(lo) > 0 === npv(hi) > 0) {
        return null;
    }
    for (let i = 0; i < BISECTIE_ITERATIES; i++) {
        const mid = (lo + hi) / 2;
        const fMid = npv(mid);
        if (fMid === 0 || hi - lo < 1e-9) {
            break;
        }
        if (fMid > 0 === npv(lo) > 0) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return new Decimal((lo + hi) / 2);
}

export const MIN_ANNUALIZED_RETURN_DAYS = 365;

export function cashflowWindowDays(flows: readonly Cashflow[]): number {
    if (flows.length < 2) {
        return 0;
    }
    let min = flows[0].date;
    let max = flows[0].date;
    for (const f of flows) {
        if (f.date < min) {
            min = f.date;
        }
        if (f.date > max) {
            max = f.date;
        }
    }
    return daysBetween(min, max);
}

function daysBetween(from: string, to: string): number {
    const start = Date.parse(`${from}T00:00:00Z`);
    const einde = Date.parse(`${to}T00:00:00Z`);
    return Math.round((einde - start) / 86_400_000);
}
