import { Transaction, TransactionTypes as T } from './types';

export interface CorporateActionGroup {
    readonly rows: readonly Transaction[];
}

interface MutableCorporateActionGroup {
    rows: Transaction[];
}

export function compareTransactions(a: Transaction, b: Transaction): number {
    return (
        a.date.localeCompare(b.date) ||
        a.time.localeCompare(b.time) ||
        b.rowIndex - a.rowIndex ||
        a.id.localeCompare(b.id)
    );
}

export function groupCorporateActions(transactions: readonly Transaction[]): readonly CorporateActionGroup[] {
    const groups: MutableCorporateActionGroup[] = [];
    const orderGroups = new Map<string, MutableCorporateActionGroup>();
    let sequence: {
        action: string;
        date: string;
        firstSide: string;
        lastSide: string;
        transitions: number;
        group: MutableCorporateActionGroup;
    } | null = null;

    for (const txn of [...transactions].sort(compareTransactions)) {
        if (txn.corporateAction === null) {
            sequence = null;
            continue;
        }
        if (txn.orderId !== null) {
            sequence = null;
            const key = `${txn.corporateAction}:order:${txn.orderId}`;
            let group = orderGroups.get(key);
            if (group === undefined) {
                group = { rows: [] };
                orderGroups.set(key, group);
                groups.push(group);
            }
            group.rows.push(txn);
            continue;
        }
        const side = txn.type === T.CorporateBuy ? 'buy' : 'sell';
        const sideChanged = sequence !== null && sequence.lastSide !== side;
        if (
            sequence === null ||
            sequence.action !== txn.corporateAction ||
            sequence.date !== txn.date ||
            (sideChanged && sequence.transitions > 0 && side === sequence.firstSide)
        ) {
            const group = { rows: [] };
            groups.push(group);
            sequence = {
                action: txn.corporateAction,
                date: txn.date,
                firstSide: side,
                lastSide: side,
                transitions: 0,
                group,
            };
        } else if (sideChanged) {
            sequence.transitions++;
            sequence.lastSide = side;
        }
        sequence.group.rows.push(txn);
    }

    return groups;
}
