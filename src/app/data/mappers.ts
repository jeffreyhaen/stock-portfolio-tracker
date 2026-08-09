import Decimal from 'decimal.js';
import { Transaction } from '../domain/types';
import { StoredTransaction } from './stored-types';

export function toStored(txn: Transaction, portfolioId: string, batchId: string): StoredTransaction {
    return {
        portfolioId,
        batchId,
        regelNr: txn.rowIndex,
        datum: txn.date,
        tijd: txn.time,
        valutadatum: txn.valueDate,
        isin: txn.isin,
        product: txn.product,
        type: txn.type,
        corporateActie: txn.corporateAction,
        omschrijvingRaw: txn.description,
        aantal: txn.quantity?.toFixed() ?? null,
        prijs: txn.price?.toFixed() ?? null,
        valuta: txn.tradeCurrency,
        mutatie: txn.mutation?.toFixed() ?? null,
        mutatieValuta: txn.mutationCurrency,
        saldo: txn.balance?.toFixed() ?? null,
        saldoValuta: txn.balanceCurrency,
        fxKoers: txn.fxRate?.toFixed() ?? null,
        orderId: txn.orderId,
        fingerprint: txn.fingerprint,
    };
}

export function fromStored(stored: StoredTransaction): Transaction {
    return {
        id: stored.fingerprint,
        date: stored.datum,
        time: stored.tijd,
        valueDate: stored.valutadatum,
        rowIndex: stored.regelNr,
        product: stored.product,
        isin: stored.isin,
        type: stored.type,
        corporateAction: stored.corporateActie,
        quantity: stored.aantal === null ? null : new Decimal(stored.aantal),
        price: stored.prijs === null ? null : new Decimal(stored.prijs),
        tradeCurrency: stored.valuta,
        mutation: stored.mutatie === null ? null : new Decimal(stored.mutatie),
        mutationCurrency: stored.mutatieValuta,
        balance: stored.saldo === null ? null : new Decimal(stored.saldo),
        balanceCurrency: stored.saldoValuta,
        fxRate: stored.fxKoers === null ? null : new Decimal(stored.fxKoers),
        orderId: stored.orderId,
        description: stored.omschrijvingRaw,
        fingerprint: stored.fingerprint,
    };
}
