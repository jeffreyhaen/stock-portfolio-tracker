import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv/parse-csv';
import { repairCsvRows } from './csv/repair-csv-rows';
import { buildLedger } from './ledger';
import { accountLots } from './lot-accounting';
import { Transaction, TransactionTypes as T } from './types';

const HEADER = 'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id';
const BUY_ORDER = '00000000-0000-4000-8000-000000000101';
const SELL_ORDER = '00000000-0000-4000-8000-000000000102';
const TAX_ORDER = '00000000-0000-4000-8000-000000000103';

function ledgerFrom(lines: string[]): Transaction[] {
    const rows = repairCsvRows(parseCsv([HEADER, ...lines].join('\n')));
    const { transactions, warnings } = buildLedger(rows);
    expect(warnings).toEqual([]);
    return transactions;
}

function quantity(lots: readonly { quantity: Decimal }[]): Decimal {
    return lots.reduce((sum, lot) => sum.plus(lot.quantity), new Decimal(0));
}

function basis(lots: readonly { basis: Decimal }[]): Decimal {
    return lots.reduce((sum, lot) => sum.plus(lot.basis), new Decimal(0));
}

describe('lot accounting with inline synthetic exports', () => {
    it('reconciles an isolated FIFO buy and sale', () => {
        const transactions = ledgerFrom([
            `02-01-2024,10:00,02-01-2024,EXAMPLE EQUITY,XS0000000101,Koop 10 @ 20 USD,,USD,"-200,00",USD,"0,00",${BUY_ORDER}`,
            `02-02-2024,10:00,02-02-2024,EXAMPLE EQUITY,XS0000000101,"Verkoop 10 @ 27,50 USD",,USD,"275,00",USD,"275,00",${SELL_ORDER}`,
        ]);
        const [buy, sell] = transactions;

        expect(buy).toMatchObject({
            type: T.TradeBuy,
            quantity: new Decimal(10),
            price: new Decimal(20),
            mutation: new Decimal(-200),
            orderId: BUY_ORDER,
        });
        expect(sell).toMatchObject({ type: T.TradeSell, quantity: new Decimal(10), orderId: SELL_ORDER });

        const result = accountLots(transactions, { reportingCurrency: 'USD' });
        expect(result.positions.get('XS0000000101')?.realizedPnl?.toFixed(2)).toBe('75.00');
        expect(result.positions.get('XS0000000101')?.lots).toHaveLength(0);
        expect(result.diagnostics).toEqual([]);
    });

    it('groups partial fills, EUR settlements, and a fee by deterministic fake order ID', () => {
        const transactions = ledgerFrom([
            `03-01-2024,11:00,03-01-2024,SAMPLE SHARES,XS0000000102,Koop 4 @ 50 USD,,USD,"-200,00",USD,"0,00",${BUY_ORDER}`,
            `03-01-2024,11:00,03-01-2024,SAMPLE SHARES,XS0000000102,Koop 6 @ 50 USD,,USD,"-300,00",USD,"0,00",${BUY_ORDER}`,
            `03-01-2024,11:00,03-01-2024,SAMPLE SHARES,XS0000000102,Valuta Debitering,,EUR,"-180,00",EUR,"820,00",${BUY_ORDER}`,
            `03-01-2024,11:00,03-01-2024,SAMPLE SHARES,XS0000000102,Valuta Debitering,,EUR,"-270,00",EUR,"550,00",${BUY_ORDER}`,
            `03-01-2024,11:00,03-01-2024,SAMPLE SHARES,XS0000000102,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-5,00",EUR,"545,00",${BUY_ORDER}`,
        ]);

        const result = accountLots(transactions);
        const position = result.positions.get('XS0000000102');
        expect(quantity(position?.lots ?? []).toFixed()).toBe('10');
        expect(position?.grossInvested.toFixed(2)).toBe('455.00');
        expect(basis(position?.lots ?? []).toFixed(2)).toBe('455.00');
        expect(result.diagnostics).toEqual([]);
    });

    it('marks a zero-cash buy-only spin-off basis missing and can later sell it', () => {
        const transactions = ledgerFrom([
            '04-01-2024,09:00,04-01-2024,SYNTHETIC SPINCO,XS0000000103,SPIN-OFF: Koop 3 @ 0 USD,,USD,"0,00",USD,"0,00",',
            `04-03-2024,09:00,04-03-2024,SYNTHETIC SPINCO,XS0000000103,Verkoop 3 @ 16 USD,,USD,"48,00",USD,"48,00",${SELL_ORDER}`,
        ]);
        const spinOff = transactions.find((txn) => txn.corporateAction === 'SPIN_OFF')!;
        const open = accountLots([spinOff]).positions.get('XS0000000103');

        expect(quantity(open?.lots ?? []).toFixed()).toBe('3');
        expect(open?.basisComplete).toBe(false);
        expect(open?.accountingComplete).toBe(false);

        const afterSale = accountLots(transactions, { reportingCurrency: 'USD' });
        expect(afterSale.positions.get('XS0000000103')?.realizedPnl?.toFixed(2)).toBe('48.00');
        expect(afterSale.positions.get('XS0000000103')?.realizedBasisAssumedZero).toBe(true);
        expect(afterSale.diagnostics).toEqual([
            expect.objectContaining({ kind: 'MISSING_CORPORATE_ACTION_BASIS', quantity: new Decimal(3) }),
        ]);
    });

    it('associates a tax without an order ID by date, time, and ISIN', () => {
        const transactions = ledgerFrom([
            '05-01-2024,14:30,05-01-2024,FICTIONAL FUND,FR0000000104,Transactiebelasting Frankrijk,,EUR,"-3,00",EUR,"997,00",',
            `05-01-2024,14:30,05-01-2024,FICTIONAL FUND,FR0000000104,Koop 5 @ 20 EUR,,EUR,"-100,00",EUR,"897,00",${TAX_ORDER}`,
        ]);
        const tax = transactions.find((txn) => txn.type === T.TransactionTax);
        const trade = transactions.find((txn) => txn.type === T.TradeBuy);

        expect(tax?.orderId).toBeNull();
        expect(trade?.orderId).toBe(TAX_ORDER);
        expect(basis(accountLots(transactions).positions.get('FR0000000104')?.lots ?? []).toFixed(2)).toBe('103.00');
    });

    it('reconciles a reverse split across different times and fictitious ISINs', () => {
        const transactions = ledgerFrom([
            '01-01-2024,10:00,01-01-2024,EXAMPLE OLD SHARES,XS0000000105,Koop 150 @ 4 EUR,,EUR,"-600,00",EUR,"400,00",00000000-0000-4000-8000-000000000104',
            '06-01-2024,08:32,06-01-2024,EXAMPLE NEW SHARES,XS0000000106,STOCK SPLIT: Koop 10 @ 60 EUR,,EUR,"-600,00",EUR,"400,00",',
            '06-01-2024,08:29,06-01-2024,EXAMPLE OLD SHARES,XS0000000105,STOCK SPLIT: Verkoop 150 @ 4 EUR,,EUR,"600,00",EUR,"1000,00",',
        ]);
        const result = accountLots(transactions);

        expect(result.positions.get('XS0000000105')?.lots).toHaveLength(0);
        expect(quantity(result.positions.get('XS0000000106')?.lots ?? []).toFixed()).toBe('10');
        expect(basis(result.positions.get('XS0000000106')?.lots ?? []).toFixed(2)).toBe('600.00');
        expect(result.diagnostics).toEqual([]);
    });
});
