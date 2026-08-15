import Decimal from 'decimal.js';
import { Transaction } from './types';

export type FxResolver = (currency: string, date: string) => Decimal | null;

export interface FxRateInput {
    readonly pair: string;
    readonly date: string;
    readonly rate: string;
}

export function mutationInReportingCurrency(
    txn: Pick<Transaction, 'mutation' | 'mutationCurrency' | 'tradeCurrency' | 'fxRate' | 'date'>,
    reportingCurrency: string,
    fxFallback?: FxResolver,
): Decimal | null {
    if (txn.mutation === null) {
        return null;
    }
    const currency = txn.mutationCurrency ?? txn.tradeCurrency;
    if (currency === null || currency === '') {
        return null;
    }
    if (currency === reportingCurrency) {
        return txn.mutation;
    }
    if (txn.fxRate !== null && !txn.fxRate.isZero()) {
        return txn.mutation.div(txn.fxRate);
    }
    const rate = fxFallback?.(currency, txn.date) ?? null;
    return rate === null ? null : txn.mutation.times(rate);
}

export function buildFxResolver(rates: readonly FxRateInput[], reportingCurrency = 'EUR'): FxResolver {
    const ratesByPair = new Map<string, { date: string; rate: Decimal }[]>();
    for (const rate of rates) {
        const list = ratesByPair.get(rate.pair) ?? [];
        list.push({ date: rate.date, rate: new Decimal(rate.rate) });
        ratesByPair.set(rate.pair, list);
    }
    for (const list of ratesByPair.values()) {
        list.sort((a, b) => a.date.localeCompare(b.date));
    }
    return (currency: string, date: string): Decimal | null => {
        if (currency === reportingCurrency) {
            return new Decimal(1);
        }
        const list = ratesByPair.get(`${currency}/${reportingCurrency}`);
        if (list === undefined) {
            return null;
        }
        let found: Decimal | null = null;
        for (const rate of list) {
            if (rate.date > date) {
                break;
            }
            found = rate.rate;
        }
        return found;
    };
}
