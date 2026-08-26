import Decimal from 'decimal.js';
import { Transaction, TransactionTypes as T } from './types';

const MERGEABLE_TYPES = new Set<string>([T.TradeBuy, T.TradeSell]);

function canMerge(a: Transaction, b: Transaction): boolean {
    return (
        a.date === b.date &&
        a.isin === b.isin &&
        a.type === b.type &&
        a.tradeCurrency === b.tradeCurrency &&
        a.mutationCurrency === b.mutationCurrency &&
        (a.fxRate === null) === (b.fxRate === null)
    );
}

function mergeGroup(orderId: string, rows: Transaction[]): Transaction {
    const sorted = [...rows].sort((a, b) => a.rowIndex - b.rowIndex);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const quantity = sorted.reduce((sum, row) => sum.plus(row.quantity as Decimal), new Decimal(0));
    const turnover = sorted.reduce(
        (sum, row) => sum.plus((row.quantity as Decimal).times(row.price as Decimal)),
        new Decimal(0),
    );
    const mutation = sorted.reduce((sum, row) => sum.plus(row.mutation as Decimal), new Decimal(0));
    const fxRate =
        first.fxRate === null
            ? null
            : (() => {
                  const foreignAmount = sorted.reduce(
                      (sum, row) => sum.plus((row.mutation as Decimal).abs()),
                      new Decimal(0),
                  );
                  const reportingAmount = sorted.reduce(
                      (sum, row) => sum.plus((row.mutation as Decimal).abs().div(row.fxRate as Decimal)),
                      new Decimal(0),
                  );
                  return reportingAmount.isZero()
                      ? sorted
                            .reduce(
                                (sum, row) => sum.plus((row.quantity as Decimal).times(row.fxRate as Decimal)),
                                new Decimal(0),
                            )
                            .div(quantity)
                      : foreignAmount.div(reportingAmount);
              })();
    const id = `merged:${orderId}:${first.type}:${first.isin}`;
    return {
        ...first,
        id,
        fingerprint: id,
        time: first.time,
        valueDate: first.valueDate,
        quantity,
        price: turnover.div(quantity),
        mutation,
        balance: last.balance,
        balanceCurrency: last.balanceCurrency,
        fxRate,
    };
}

export function mergeSplitExecutions(transactions: readonly Transaction[]): Transaction[] {
    const groups = new Map<string, Transaction[]>();
    const passthrough: Transaction[] = [];
    for (const txn of transactions) {
        if (txn.orderId === null || !MERGEABLE_TYPES.has(txn.type) || txn.isin === null) {
            passthrough.push(txn);
            continue;
        }
        const key = `${txn.orderId}:${txn.isin}:${txn.type}`;
        const group = groups.get(key) ?? [];
        group.push(txn);
        groups.set(key, group);
    }
    const merged: Transaction[] = [];
    for (const [key, group] of groups) {
        const complete =
            group.length > 1 &&
            group.every(
                (row) =>
                    row.quantity !== null &&
                    row.price !== null &&
                    row.mutation !== null &&
                    !row.quantity.isZero() &&
                    group.every((other) => canMerge(row, other)),
            );
        if (complete) {
            merged.push(mergeGroup(key.split(':')[0], group));
        } else {
            passthrough.push(...group);
        }
    }
    return [...passthrough, ...merged].sort((a, b) => a.rowIndex - b.rowIndex);
}
