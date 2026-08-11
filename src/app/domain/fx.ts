import Decimal from 'decimal.js';
import { Transaction } from './types';

export type FxResolver = (valuta: string, datum: string) => Decimal | null;

export interface FxRateInput {
    readonly paar: string;
    readonly datum: string;
    readonly koers: string;
}

export function mutationInRapportagevaluta(
    txn: Pick<Transaction, 'mutation' | 'mutationCurrency' | 'tradeCurrency' | 'fxRate' | 'date'>,
    rapportagevaluta: string,
    fxFallback?: FxResolver,
): Decimal | null {
    if (txn.mutation === null) {
        return null;
    }
    const valuta = txn.mutationCurrency ?? txn.tradeCurrency;
    if (valuta === null || valuta === '') {
        return null;
    }
    if (valuta === rapportagevaluta) {
        return txn.mutation;
    }
    if (txn.fxRate !== null && !txn.fxRate.isZero()) {
        return txn.mutation.div(txn.fxRate);
    }
    const koers = fxFallback?.(valuta, txn.date) ?? null;
    return koers === null ? null : txn.mutation.times(koers);
}

export function buildFxResolver(rates: readonly FxRateInput[], rapportagevaluta = 'EUR'): FxResolver {
    const perPaar = new Map<string, { datum: string; koers: Decimal }[]>();
    for (const rate of rates) {
        const lijst = perPaar.get(rate.paar) ?? [];
        lijst.push({ datum: rate.datum, koers: new Decimal(rate.koers) });
        perPaar.set(rate.paar, lijst);
    }
    for (const lijst of perPaar.values()) {
        lijst.sort((a, b) => a.datum.localeCompare(b.datum));
    }
    return (valuta: string, datum: string): Decimal | null => {
        if (valuta === rapportagevaluta) {
            return new Decimal(1);
        }
        const lijst = perPaar.get(`${valuta}/${rapportagevaluta}`);
        if (lijst === undefined) {
            return null;
        }
        let gevonden: Decimal | null = null;
        for (const rate of lijst) {
            if (rate.datum > datum) {
                break;
            }
            gevonden = rate.koers;
        }
        return gevonden;
    };
}
