import Decimal from 'decimal.js';
import { classifyDescription } from './classify';
import { parseLocalizedDate, parseLocalizedNumber } from './numbers';
import { ImportWarning, RawCsvRow, Transaction, TransactionTypes } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toRawRow(columns: readonly string[], rowIndex: number): RawCsvRow {
    return {
        date: columns[0],
        time: columns[1],
        valueDate: columns[2],
        product: columns[3],
        isin: columns[4],
        description: columns[5],
        fx: columns[6],
        mutationCurrency: columns[7],
        mutation: columns[8],
        balanceCurrency: columns[9],
        balance: columns[10],
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
            row.date,
            row.time,
            row.product,
            row.isin,
            row.description,
            row.fx,
            row.mutationCurrency,
            row.mutation,
            row.balanceCurrency,
            row.balance,
            row.orderId,
        ].join(''),
    );
}

function optionalNumber(raw: string): Decimal | null {
    return raw.trim() === '' ? null : parseLocalizedNumber(raw);
}

export function toTransaction(row: RawCsvRow, warnings: ImportWarning[]): Transaction {
    const classification = classifyDescription(row.description);
    if (classification.type === TransactionTypes.Unknown) {
        warnings.push({
            rowIndex: row.rowIndex,
            description: row.description,
            reason: 'Unknown description — excluded from positions and flows',
        });
    }
    const fingerprint = fingerprintOf(row);
    return {
        id: fingerprint,
        date: parseLocalizedDate(row.date),
        time: row.time,
        valueDate: parseLocalizedDate(row.valueDate),
        rowIndex: row.rowIndex,
        product: row.product,
        isin: row.isin.trim() === '' ? null : row.isin,
        type: classification.type,
        corporateAction: classification.corporateAction,
        quantity: classification.quantity,
        price: classification.price,
        tradeCurrency: classification.tradeCurrency,
        mutation: optionalNumber(row.mutation),
        mutationCurrency: row.mutationCurrency.trim() === '' ? null : row.mutationCurrency,
        balance: optionalNumber(row.balance),
        balanceCurrency: row.balanceCurrency.trim() === '' ? null : row.balanceCurrency,
        fxRate: optionalNumber(row.fx),
        orderId: UUID.test(row.orderId) ? row.orderId : null,
        description: row.description,
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
