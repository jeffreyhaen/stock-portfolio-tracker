import Decimal from 'decimal.js';
import { Transaction, TransactionTypes as T } from './types';

export type FxResolver = (currency: string, date: string) => Decimal | null;

export interface FxRateInput {
    readonly pair: string;
    readonly date: string;
    readonly rate: string;
}

export type FxProvenance = 'identity' | 'imported' | 'market';

export interface FxConversion {
    readonly amount: Decimal;
    readonly rate: Decimal;
    readonly provenance: FxProvenance;
}

export function convertToReportingCurrency(
    amount: Decimal,
    currency: string,
    date: string,
    reportingCurrency: string,
    fx: FxResolver | undefined,
    transactionFxRate: Decimal | null = null,
    importedFx?: FxResolver,
): FxConversion | null {
    if (currency === reportingCurrency) {
        return { amount, rate: new Decimal(1), provenance: 'identity' };
    }
    const marketRate = fx?.(currency, date) ?? null;
    if (marketRate !== null) {
        return { amount: amount.times(marketRate), rate: marketRate, provenance: 'market' };
    }
    const importedRate = importedFx?.(currency, date) ?? null;
    if (importedRate !== null) {
        return { amount: amount.times(importedRate), rate: importedRate, provenance: 'imported' };
    }
    if (
        reportingCurrency === 'EUR' &&
        transactionFxRate !== null &&
        transactionFxRate.isFinite() &&
        transactionFxRate.gt(0)
    ) {
        const rate = new Decimal(1).div(transactionFxRate);
        return { amount: amount.times(rate), rate, provenance: 'imported' };
    }
    return null;
}

export function convertTransactionToReportingCurrency(
    amount: Decimal,
    currency: string,
    date: string,
    reportingCurrency: string,
    transactionFxRate: Decimal | null,
    importedFx: FxResolver | undefined,
    marketFx: FxResolver | undefined,
): FxConversion | null {
    if (currency === reportingCurrency) {
        return { amount, rate: new Decimal(1), provenance: 'identity' };
    }
    const importedRate = importedFx?.(currency, date) ?? null;
    if (importedRate !== null) {
        return { amount: amount.times(importedRate), rate: importedRate, provenance: 'imported' };
    }
    if (
        reportingCurrency === 'EUR' &&
        transactionFxRate !== null &&
        transactionFxRate.isFinite() &&
        transactionFxRate.gt(0)
    ) {
        const rate = new Decimal(1).div(transactionFxRate);
        return { amount: amount.times(rate), rate, provenance: 'imported' };
    }
    const marketRate = marketFx?.(currency, date) ?? null;
    return marketRate === null
        ? null
        : { amount: amount.times(marketRate), rate: marketRate, provenance: 'market' };
}

export function mutationInReportingCurrency(
    txn: Pick<Transaction, 'mutation' | 'mutationCurrency' | 'tradeCurrency' | 'fxRate' | 'date'>,
    reportingCurrency: string,
    fxFallback?: FxResolver,
): Decimal | null {
    if (txn.mutation === null) return null;
    const currency = txn.mutationCurrency ?? txn.tradeCurrency;
    if (currency === null || currency === '') return null;
    if (currency === reportingCurrency) return txn.mutation;
    if (reportingCurrency === 'EUR' && txn.fxRate !== null && txn.fxRate.isFinite() && txn.fxRate.gt(0)) {
        return txn.mutation.div(txn.fxRate);
    }
    const fallbackRate = fxFallback?.(currency, txn.date) ?? null;
    return fallbackRate === null ? null : txn.mutation.times(fallbackRate);
}

export function buildImportedFxResolver(
    transactions: readonly Pick<
        Transaction,
        | 'date'
        | 'time'
        | 'rowIndex'
        | 'type'
        | 'orderId'
        | 'mutation'
        | 'mutationCurrency'
        | 'tradeCurrency'
        | 'fxRate'
    >[],
    reportingCurrency = 'EUR',
): FxResolver {
    if (reportingCurrency !== 'EUR') {
        return (currency) => (currency === reportingCurrency ? new Decimal(1) : null);
    }
    const conversionRows = transactions.filter(
        (txn) =>
            (txn.type === T.FxDebit || txn.type === T.FxCredit) &&
            txn.mutation !== null &&
            txn.mutationCurrency !== null,
    );
    const groups = new Map<string, typeof conversionRows>();
    for (const txn of conversionRows) {
        const key = txn.orderId === null ? `${txn.date}:${txn.time}` : `order:${txn.orderId}`;
        const group = groups.get(key) ?? [];
        group.push(txn);
        groups.set(key, group);
    }
    const ratesByCurrency = new Map<
        string,
        { date: string; time: string; rowIndex: number; priority: number; rate: Decimal }[]
    >();
    for (const txn of transactions) {
        const currency = txn.mutationCurrency ?? txn.tradeCurrency;
        if (
            currency === null ||
            currency === reportingCurrency ||
            txn.fxRate === null ||
            !txn.fxRate.isFinite() ||
            !txn.fxRate.gt(0)
        ) {
            continue;
        }
        const list = ratesByCurrency.get(currency) ?? [];
        list.push({
            date: txn.date,
            time: txn.time,
            rowIndex: txn.rowIndex,
            priority: 0,
            rate: new Decimal(1).div(txn.fxRate),
        });
        ratesByCurrency.set(currency, list);
    }
    for (const group of groups.values()) {
        const reportingAmount = group
            .filter((txn) => txn.mutationCurrency === reportingCurrency)
            .reduce((sum, txn) => sum.plus((txn.mutation as Decimal).abs()), new Decimal(0));
        if (!reportingAmount.gt(0)) continue;
        const foreignAmounts = new Map<string, Decimal>();
        for (const txn of group) {
            const currency = txn.mutationCurrency as string;
            if (currency === reportingCurrency) continue;
            foreignAmounts.set(currency, (foreignAmounts.get(currency) ?? new Decimal(0)).plus((txn.mutation as Decimal).abs()));
        }
        const anchor = [...group].sort(
            (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || b.rowIndex - a.rowIndex,
        )[group.length - 1];
        for (const [currency, foreignAmount] of foreignAmounts) {
            if (!foreignAmount.gt(0)) continue;
            const list = ratesByCurrency.get(currency) ?? [];
            list.push({
                date: anchor.date,
                time: anchor.time,
                rowIndex: anchor.rowIndex,
                priority: 1,
                rate: reportingAmount.div(foreignAmount),
            });
            ratesByCurrency.set(currency, list);
        }
    }
    for (const list of ratesByCurrency.values()) {
        list.sort(
            (a, b) =>
                a.date.localeCompare(b.date) ||
                a.time.localeCompare(b.time) ||
                b.rowIndex - a.rowIndex ||
                a.priority - b.priority,
        );
    }
    return (currency, date) => {
        if (currency === reportingCurrency) return new Decimal(1);
        let found: Decimal | null = null;
        for (const entry of ratesByCurrency.get(currency) ?? []) {
            if (entry.date > date) break;
            found = entry.rate;
        }
        return found;
    };
}

export function buildFxResolver(rates: readonly FxRateInput[], reportingCurrency = 'EUR'): FxResolver {
    const ratesByPair = new Map<string, { date: string; rate: Decimal }[]>();
    for (const rate of rates) {
        const list = ratesByPair.get(rate.pair) ?? [];
        list.push({ date: rate.date, rate: new Decimal(rate.rate) });
        ratesByPair.set(rate.pair, list);
    }
    for (const list of ratesByPair.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return (currency, date) => {
        if (currency === reportingCurrency) return new Decimal(1);
        const list = ratesByPair.get(`${currency}/${reportingCurrency}`);
        if (list === undefined) return null;
        let found: Decimal | null = null;
        for (const rate of list) {
            if (rate.date > date) break;
            found = rate.rate;
        }
        return found;
    };
}
