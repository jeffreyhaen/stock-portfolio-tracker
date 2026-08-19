import { parseCsv } from './csv/parse-csv';
import { repairCsvRows } from './csv/repair-csv-rows';
import { buildLedger } from './ledger';
import { cashAt, externalFlows, positionsAt } from './engine';
import { mergeTransactions } from './dedup';
import { Transaction, TransactionTypes as T } from './types';

const HEADER = 'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id';
const ENGLISH_HEADER = 'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id';

export function ledgerFrom(lines: string[], header = HEADER): { transactions: Transaction[] } {
    const rows = repairCsvRows(parseCsv([header, ...lines].join('\n')));
    const { transactions, warnings } = buildLedger(rows);
    expect(warnings).toEqual([]);
    return { transactions };
}

describe('buildLedger', () => {
    it('skips the English DEGIRO header', () => {
        const { transactions } = ledgerFrom(
            ['01-01-2024,10:00,01-01-2024,,,iDEAL Deposit,,EUR,"100,00",EUR,"100,00",'],
            ENGLISH_HEADER,
        );

        expect(transactions).toHaveLength(1);
        expect(transactions[0].description).toBe('iDEAL Deposit');
    });

    it('imports the newer split adjustment rows as a stock split', () => {
        const { transactions } = ledgerFrom(
            [
                '01-02-2024,08:32,31-01-2024,EXAMPLE HOLDINGS,XS0000000002,"SPLIT AANPASSING: 250 EXAMPLE HOLDINGS @ 12,50 EUR (XS0000000002)",,EUR,"-3125,00",EUR,"1000,00",',
                '01-02-2024,08:29,31-01-2024,EXAMPLE HOLDINGS,XS0000000001,"SPLIT AANPASSING: 1.000 Example Holdings @ 3,125 EUR (XS0000000001)",,EUR,"3125,00",EUR,"4125,00",',
            ],
            ENGLISH_HEADER,
        );

        expect(transactions.map((transaction) => transaction.type)).toEqual([T.CorporateBuy, T.CorporateSell]);
        expect(transactions.map((transaction) => transaction.corporateAction)).toEqual(['STOCK_SPLIT', 'STOCK_SPLIT']);
    });
});

describe('positionsAt', () => {
    const lines = [
        '12-02-2026,10:00,12-02-2026,EXAMPLE EQUITY,XS0000000301,"Koop 2 @ 100,00 USD",,USD,"-200,00",USD,"100,00",00000000-0000-4000-8000-000000000301',
        '01-03-2021,10:00,01-03-2021,EXAMPLE EQUITY,XS0000000301,"Koop 8 @ 80,00 USD",,USD,"-640,00",USD,"100,00",00000000-0000-4000-8000-000000000302',
        '15-05-2021,10:00,15-05-2021,EXAMPLE EQUITY,XS0000000301,"Verkoop 3 @ 90,00 USD",,USD,"270,00",USD,"370,00",00000000-0000-4000-8000-000000000303',
        '14-05-2021,10:00,14-05-2021,EXAMPLE OLD SHARES,XS0000000302,"STOCK SPLIT: Verkoop 150 @ 4 EUR",,EUR,"0,00",EUR,"0,00",',
        '14-05-2021,10:00,14-05-2021,EXAMPLE NEW SHARES,XS0000000303,"STOCK SPLIT: Koop 10 @ 60 EUR",,EUR,"0,00",EUR,"0,00",',
        '01-04-2021,10:00,01-04-2021,EXAMPLE OLD SHARES,XS0000000302,"Koop 150 @ 4 EUR",,EUR,"-600,00",EUR,"0,00",00000000-0000-4000-8000-000000000304',
        '01-06-2021,10:00,01-06-2021,CASH FUND,LU1959429272,"Conversie geldmarktfonds: Koop 100 @ 1,0045 EUR",,EUR,,EUR,"0,00",',
    ];

    it('sums trades per ISIN and respects the cutoff', () => {
        const { transactions } = ledgerFrom(lines);
        const at = positionsAt(transactions, '2021-04-30');
        expect(at.get('XS0000000302')?.toFixed()).toBe('150');
        expect(at.get('XS0000000301')?.toFixed()).toBe('8');
        expect(at.has('XS0000000303')).toBe(false);
    });

    it('processes corporate actions as regular trades', () => {
        const { transactions } = ledgerFrom(lines);
        const at = positionsAt(transactions, '2021-05-20');
        expect(at.get('XS0000000302')?.isZero()).toBe(true);
        expect(at.get('XS0000000303')?.toFixed()).toBe('10');
        expect(at.get('XS0000000301')?.toFixed()).toBe('5');
    });

    it('clamps an oversell instead of creating an implicit short', () => {
        const { transactions } = ledgerFrom([
            '01-01-2024,10:00,01-01-2024,TEST,TEST,"Koop 1 @ 10,00 EUR",,EUR,"-10,00",EUR,"90,00",',
            '02-01-2024,10:00,02-01-2024,TEST,TEST,"Verkoop 2 @ 20,00 EUR",,EUR,"40,00",EUR,"130,00",',
        ]);

        expect(positionsAt(transactions).get('TEST')?.toFixed()).toBe('0');
    });

    it('ignores money-market fund conversions', () => {
        const { transactions } = ledgerFrom(lines);
        const at = positionsAt(transactions);
        expect(at.has('LU1959429272')).toBe(false);
    });
});

describe('cashAt', () => {
    const lines = [
        '12-02-2026,20:32,12-02-2026,,,Degiro Cash Sweep Transfer,,EUR,"-250,00",EUR,"12345,67",',
        '12-02-2026,19:40,12-02-2026,SAMPLE EQUITY,XS0000000201,Valuta Creditering,"1,25",USD,"125,00",USD,"0,00",00000000-0000-4000-8000-000000000201',
        '01-01-2026,10:00,01-01-2026,,,iDEAL Deposit,,EUR,"1000,00",EUR,"1000,00",',
    ];

    it('returns the latest balance per currency', () => {
        const { transactions } = ledgerFrom(lines);
        const cash = cashAt(transactions);
        expect(cash.get('EUR')?.amount.toFixed(2)).toBe('12345.67');
        expect(cash.get('USD')?.amount.toFixed()).toBe('0');
        expect(cash.get('EUR')?.asOfDate).toBe('2026-02-12');
    });

    it('respects the cutoff', () => {
        const { transactions } = ledgerFrom(lines);
        const cash = cashAt(transactions, '2026-01-15');
        expect(cash.get('EUR')?.amount.toFixed()).toBe('1000');
        expect(cash.has('USD')).toBe(false);
    });
});

describe('externalFlows', () => {
    it('sums deposits and withdrawals per currency', () => {
        const { transactions } = ledgerFrom([
            '01-01-2021,10:00,01-01-2021,,,iDEAL Deposit,,EUR,"10000,00",EUR,"10000,00",',
            '01-02-2021,10:00,01-02-2021,,,iDEAL storting,,EUR,"2500,50",EUR,"12500,50",',
            '01-03-2021,10:00,01-03-2021,,,Terugstorting,,EUR,"-750,00",EUR,"11750,50",',
            '01-04-2021,10:00,01-04-2021,,,Reservation iDEAL,,EUR,"1000,00",EUR,"12750,50",',
            '02-04-2021,10:00,02-04-2021,,,Reservation iDEAL,,EUR,"-1000,00",EUR,"11750,50",',
            '01-05-2021,10:00,01-05-2021,,,Verrekening Welkomstactie,,EUR,"25,00",EUR,"11775,50",',
        ]);
        const flows = externalFlows(transactions);
        const eur = flows.get('EUR');
        expect(eur?.deposits.toFixed()).toBe('12500.5');
        expect(eur?.withdrawals.toFixed()).toBe('-750');
    });
});

describe('mergeTransactions', () => {
    const lines = [
        '12-02-2026,10:00,12-02-2026,SAMPLE SHARES,XS0000000304,"Koop 4 @ 25,00 USD",,USD,"-100,00",USD,"100,00",00000000-0000-4000-8000-000000000305',
        '12-02-2026,10:00,12-02-2026,SAMPLE SHARES,XS0000000304,"Koop 4 @ 25,00 USD",,USD,"-100,00",USD,"100,00",00000000-0000-4000-8000-000000000305',
        '01-03-2021,10:00,01-03-2021,SAMPLE SHARES,XS0000000304,"Koop 6 @ 20,00 USD",,USD,"-120,00",USD,"100,00",00000000-0000-4000-8000-000000000306',
    ];

    it('allows legitimate duplicate partial fills on first import', () => {
        const { transactions } = ledgerFrom(lines);
        const result = mergeTransactions([], transactions);
        expect(result.added).toHaveLength(3);
        expect(result.skippedDuplicates).toBe(0);
    });

    it('skips exactly as many duplicates as exist on reimport (count-based)', () => {
        const { transactions } = ledgerFrom(lines);
        const first = mergeTransactions([], transactions);
        const second = mergeTransactions(first.added, transactions);
        expect(second.added).toHaveLength(0);
        expect(second.skippedDuplicates).toBe(3);
    });

    it('only adds new rows on incremental import', () => {
        const { transactions: oldBatch } = ledgerFrom([lines[2]]);
        const { transactions: newBatch } = ledgerFrom(lines);
        const result = mergeTransactions(oldBatch, newBatch);
        expect(result.skippedDuplicates).toBe(1);
        expect(result.added).toHaveLength(2);
    });
});
