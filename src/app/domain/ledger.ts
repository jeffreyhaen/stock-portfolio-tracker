import Decimal from 'decimal.js';
import { classifyDescription } from './classify';
import { parseNlDate, parseNlNumber } from './numbers';
import { ImportWarning, RawCsvRow, Transaction, TransactionTypes } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toRawRow(columns: readonly string[], rowIndex: number): RawCsvRow {
    return {
        datum: columns[0],
        tijd: columns[1],
        valutadatum: columns[2],
        product: columns[3],
        isin: columns[4],
        omschrijving: columns[5],
        fx: columns[6],
        mutatieCurrency: columns[7],
        mutatie: columns[8],
        saldoCurrency: columns[9],
        saldo: columns[10],
        orderId: columns[11],
        rowIndex,
    };
}

function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function fingerprintOf(row: RawCsvRow): string {
    return fnv1a(
        [
            row.datum,
            row.tijd,
            row.product,
            row.isin,
            row.omschrijving,
            row.fx,
            row.mutatieCurrency,
            row.mutatie,
            row.saldoCurrency,
            row.saldo,
            row.orderId,
        ].join(''),
    );
}

function optionalNumber(raw: string): Decimal | null {
    return raw.trim() === '' ? null : parseNlNumber(raw);
}

export function toTransaction(row: RawCsvRow, warnings: ImportWarning[]): Transaction {
    const classification = classifyDescription(row.omschrijving);
    if (classification.type === TransactionTypes.Unknown) {
        warnings.push({
            rowIndex: row.rowIndex,
            description: row.omschrijving,
            reason: 'Onbekende omschrijving — telt niet mee in posities of flows',
        });
    }
    const fingerprint = fingerprintOf(row);
    return {
        id: fingerprint,
        date: parseNlDate(row.datum),
        time: row.tijd,
        valueDate: parseNlDate(row.valutadatum),
        rowIndex: row.rowIndex,
        product: row.product,
        isin: row.isin.trim() === '' ? null : row.isin,
        type: classification.type,
        corporateAction: classification.corporateAction,
        quantity: classification.quantity,
        price: classification.price,
        tradeCurrency: classification.tradeCurrency,
        mutation: optionalNumber(row.mutatie),
        mutationCurrency: row.mutatieCurrency.trim() === '' ? null : row.mutatieCurrency,
        balance: optionalNumber(row.saldo),
        balanceCurrency: row.saldoCurrency.trim() === '' ? null : row.saldoCurrency,
        fxRate: optionalNumber(row.fx),
        orderId: UUID.test(row.orderId) ? row.orderId : null,
        description: row.omschrijving,
        fingerprint,
    };
}

export function buildLedger(rows: readonly string[][]): { transactions: Transaction[]; warnings: ImportWarning[] } {
    const warnings: ImportWarning[] = [];
    const transactions = rows
        .filter((columns) => columns[0] !== 'Datum')
        .map((columns, index) => toTransaction(toRawRow(columns, index), warnings));
    return { transactions, warnings };
}
