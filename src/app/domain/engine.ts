import Decimal from 'decimal.js';
import { Transaction, TransactionTypes as T } from './types';

const POSITION_TYPES = new Set<string>([T.TradeBuy, T.TradeSell, T.CorporateBuy, T.CorporateSell]);
const SELL_TYPES = new Set<string>([T.TradeSell, T.CorporateSell]);

function withinCutoff(txn: Transaction, cutoff: string | undefined): boolean {
    return cutoff === undefined || txn.date <= cutoff;
}

export function positionsAt(transactions: readonly Transaction[], cutoff?: string): Map<string, Decimal> {
    const positions = new Map<string, Decimal>();
    for (const txn of transactions) {
        if (!POSITION_TYPES.has(txn.type) || txn.isin === null || txn.quantity === null) {
            continue;
        }
        if (!withinCutoff(txn, cutoff)) {
            continue;
        }
        const signed = SELL_TYPES.has(txn.type) ? txn.quantity.neg() : txn.quantity;
        const current = positions.get(txn.isin) ?? new Decimal(0);
        positions.set(txn.isin, current.plus(signed));
    }
    return positions;
}

export interface CashPosition {
    readonly currency: string;
    readonly amount: Decimal;
    readonly asOfDate: string;
    readonly asOfTime: string;
}

export function cashAt(transactions: readonly Transaction[], cutoff?: string): Map<string, CashPosition> {
    const candidates = transactions.filter(
        (txn) => txn.balance !== null && txn.balanceCurrency !== null && withinCutoff(txn, cutoff),
    );
    candidates.sort((a, b) => {
        const dateKey = `${b.date}T${b.time}`;
        const otherKey = `${a.date}T${a.time}`;
        if (dateKey !== otherKey) {
            return dateKey < otherKey ? -1 : 1;
        }
        return a.rowIndex - b.rowIndex;
    });
    const result = new Map<string, CashPosition>();
    for (const txn of candidates) {
        const currency = txn.balanceCurrency as string;
        if (result.has(currency)) {
            continue;
        }
        result.set(currency, {
            currency,
            amount: txn.balance as Decimal,
            asOfDate: txn.date,
            asOfTime: txn.time,
        });
    }
    return result;
}

export interface ExternalFlows {
    readonly currency: string;
    readonly deposits: Decimal;
    readonly withdrawals: Decimal;
}

export function externalFlows(transactions: readonly Transaction[]): Map<string, ExternalFlows> {
    const flows = new Map<string, { deposits: Decimal; withdrawals: Decimal }>();
    for (const txn of transactions) {
        if (txn.type !== T.Deposit && txn.type !== T.Withdrawal) {
            continue;
        }
        if (txn.mutation === null || txn.mutationCurrency === null) {
            continue;
        }
        const entry = flows.get(txn.mutationCurrency) ?? { deposits: new Decimal(0), withdrawals: new Decimal(0) };
        const updated =
            txn.type === T.Deposit
                ? { deposits: entry.deposits.plus(txn.mutation), withdrawals: entry.withdrawals }
                : { deposits: entry.deposits, withdrawals: entry.withdrawals.plus(txn.mutation) };
        flows.set(txn.mutationCurrency, updated);
    }
    const result = new Map<string, ExternalFlows>();
    for (const [currency, entry] of flows) {
        result.set(currency, { currency, deposits: entry.deposits, withdrawals: entry.withdrawals });
    }
    return result;
}
