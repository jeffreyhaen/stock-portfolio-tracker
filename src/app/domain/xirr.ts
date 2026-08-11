import Decimal from 'decimal.js';
import { FxResolver, mutationInRapportagevaluta } from './fx';
import { Transaction } from './types';

export interface Cashflow {
    readonly datum: string;
    readonly bedrag: Decimal;
}

const MIN_RENDEMENT = -0.9999;
const MAX_RENDEMENT = 100;
const BISECTIE_ITERATIES = 100;
const DAGEN_PER_JAAR = 365;

export function xirr(flows: readonly Cashflow[]): Decimal | null {
    const heeftInstroom = flows.some((f) => f.bedrag.isPositive() && !f.bedrag.isZero());
    const heeftUitstroom = flows.some((f) => f.bedrag.isNegative() && !f.bedrag.isZero());
    if (!heeftInstroom || !heeftUitstroom) {
        return null;
    }
    const t0 = flows.reduce((min, f) => (f.datum < min ? f.datum : min), flows[0].datum);
    const punten = flows.map((f) => ({ jaren: dagenTussen(t0, f.datum) / DAGEN_PER_JAAR, bedrag: f.bedrag.toNumber() }));
    const npv = (r: number): number => {
        let som = 0;
        for (const p of punten) {
            som += p.bedrag / Math.pow(1 + r, p.jaren);
        }
        return som;
    };
    let lo = MIN_RENDEMENT;
    let hi = MAX_RENDEMENT;
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
    readonly rapportagevaluta?: string;
    readonly fxFallback?: FxResolver;
}

export function cashflowsPerIsin(
    transactions: readonly Transaction[],
    options: CashflowOptions = {},
): Map<string, Cashflow[] | null> {
    const { rapportagevaluta = 'EUR', fxFallback } = options;
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
        const bedrag = mutationInRapportagevaluta(txn, rapportagevaluta, fxFallback);
        if (bedrag === null) {
            perIsin.set(txn.isin, null);
            continue;
        }
        flows.push({ datum: txn.date, bedrag });
    }
    return perIsin;
}

export function holdingCashflows(
    transactions: readonly Transaction[],
    isin: string,
    options: CashflowOptions = {},
): Cashflow[] | null {
    const { rapportagevaluta = 'EUR', fxFallback } = options;
    const flows: Cashflow[] = [];
    for (const txn of transactions) {
        if (txn.isin !== isin || txn.mutation === null) {
            continue;
        }
        const bedrag = mutationInRapportagevaluta(txn, rapportagevaluta, fxFallback);
        if (bedrag === null) {
            return null;
        }
        flows.push({ datum: txn.date, bedrag });
    }
    return flows;
}

function dagenTussen(van: string, tot: string): number {
    const start = Date.parse(`${van}T00:00:00Z`);
    const einde = Date.parse(`${tot}T00:00:00Z`);
    return Math.round((einde - start) / 86_400_000);
}
