import Decimal from 'decimal.js';
import { Transaction } from '../domain/types';
import { StoredTransaction } from './stored-types';

export function toStored(txn: Transaction, portfolioId: string, batchId: string): StoredTransaction {
    return {
        portfolioId,
        batchId,
        rowIndex: txn.rowIndex,
        date: txn.date,
        time: txn.time,
        valueDate: txn.valueDate,
        isin: txn.isin,
        product: txn.product,
        type: txn.type,
        corporateAction: txn.corporateAction,
        rawDescription: txn.description,
        quantity: txn.quantity?.toFixed() ?? null,
        price: txn.price?.toFixed() ?? null,
        currency: txn.tradeCurrency,
        mutation: txn.mutation?.toFixed() ?? null,
        mutationCurrency: txn.mutationCurrency,
        balance: txn.balance?.toFixed() ?? null,
        balanceCurrency: txn.balanceCurrency,
        fxRate: txn.fxRate?.toFixed() ?? null,
        orderId: txn.orderId,
        fingerprint: txn.fingerprint,
    };
}

export function fromStored(stored: StoredTransaction): Transaction {
    return {
        id: stored.fingerprint,
        date: stored.date,
        time: stored.time,
        valueDate: stored.valueDate,
        rowIndex: stored.rowIndex,
        product: stored.product,
        isin: stored.isin,
        type: stored.type,
        corporateAction: stored.corporateAction,
        quantity: stored.quantity === null ? null : new Decimal(stored.quantity),
        price: stored.price === null ? null : new Decimal(stored.price),
        tradeCurrency: stored.currency,
        mutation: stored.mutation === null ? null : new Decimal(stored.mutation),
        mutationCurrency: stored.mutationCurrency,
        balance: stored.balance === null ? null : new Decimal(stored.balance),
        balanceCurrency: stored.balanceCurrency,
        fxRate: stored.fxRate === null ? null : new Decimal(stored.fxRate),
        orderId: stored.orderId,
        description: stored.rawDescription,
        fingerprint: stored.fingerprint,
    };
}
