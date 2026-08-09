import { Transaction } from './types';

export interface MergeResult {
    readonly added: Transaction[];
    readonly skippedDuplicates: number;
}

export function mergeTransactions(existing: readonly Transaction[], incoming: readonly Transaction[]): MergeResult {
    const counts = new Map<string, number>();
    for (const txn of existing) {
        counts.set(txn.fingerprint, (counts.get(txn.fingerprint) ?? 0) + 1);
    }
    const added: Transaction[] = [];
    let skipped = 0;
    for (const txn of incoming) {
        const remaining = counts.get(txn.fingerprint) ?? 0;
        if (remaining > 0) {
            counts.set(txn.fingerprint, remaining - 1);
            skipped += 1;
        } else {
            added.push(txn);
        }
    }
    return { added, skippedDuplicates: skipped };
}
