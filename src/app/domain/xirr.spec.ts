import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Transaction, TransactionTypes as T } from './types';
import { cashflowWindowDays, holdingCashflows, portfolioCashflows, xirr } from './xirr';

let volgNr = 0;

function txn(overrides: Partial<Transaction>): Transaction {
    volgNr += 1;
    return {
        id: `t${volgNr}`,
        date: '2024-01-01',
        time: '10:00',
        valueDate: '2024-01-01',
        rowIndex: volgNr,
        product: 'Test',
        isin: 'TEST',
        type: T.TradeBuy,
        corporateAction: null,
        quantity: new Decimal(10),
        price: new Decimal(100),
        tradeCurrency: 'EUR',
        mutation: new Decimal(-1000),
        mutationCurrency: 'EUR',
        balance: null,
        balanceCurrency: null,
        fxRate: null,
        orderId: null,
        description: '',
        fingerprint: `fp${volgNr}`,
        ...overrides,
    };
}

describe('xirr', () => {
    it('calculates the return on a single investment that doubles in a year', () => {
        const r = xirr([
            { date: '2025-01-01', amount: new Decimal(-1000) },
            { date: '2026-01-01', amount: new Decimal(2000) },
        ]);
        expect(r?.toFixed(4)).toBe('1.0000');
    });

    it('returns ~10% for +10% over exactly a year', () => {
        const r = xirr([
            { date: '2025-01-01', amount: new Decimal(-1000) },
            { date: '2026-01-01', amount: new Decimal(1100) },
        ]);
        expect(Number(r?.toFixed(4))).toBeCloseTo(0.1, 3);
    });

    it('weighs later inflows less heavily than earlier ones', () => {
        const vroeg = xirr([
            { date: '2024-01-01', amount: new Decimal(-1000) },
            { date: '2025-01-01', amount: new Decimal(1500) },
        ]);
        const laat = xirr([
            { date: '2024-01-01', amount: new Decimal(-1000) },
            { date: '2026-01-01', amount: new Decimal(1500) },
        ]);
        expect(vroeg?.comparedTo(laat ?? 0)).toBe(1);
    });

    it('accounts for interim buys and sells', () => {
        const r = xirr([
            { date: '2024-01-01', amount: new Decimal(-1000) },
            { date: '2024-07-01', amount: new Decimal(600) },
            { date: '2025-01-01', amount: new Decimal(600) },
        ]);
        expect(Number(r?.toFixed(3))).toBeCloseTo(0.28, 2);
    });

    it('returns null without both inflows and outflows', () => {
        expect(xirr([{ date: '2024-01-01', amount: new Decimal(-1000) }])).toBeNull();
        expect(xirr([{ date: '2024-01-01', amount: new Decimal(1000) }])).toBeNull();
        expect(xirr([])).toBeNull();
    });
});

describe('holdingCashflows', () => {
    it('builds flows per isin including dividend, excluding other isins', () => {
        const flows = holdingCashflows(
            [
                txn({ date: '2024-01-01', mutation: new Decimal(-1000) }),
                txn({ date: '2024-06-01', type: T.Dividend, quantity: null, mutation: new Decimal(25) }),
                txn({ date: '2024-06-02', isin: 'ANDER', mutation: new Decimal(-500) }),
            ],
            'TEST',
        );
        expect(flows).toHaveLength(2);
        expect(flows?.[1].amount.toFixed(0)).toBe('25');
    });

    it('converts to reportingCurrency via fxRate from the transaction', () => {
        const flows = holdingCashflows(
            [txn({ mutation: new Decimal(-1200), mutationCurrency: 'USD', fxRate: new Decimal('1.2') })],
            'TEST',
        );
        expect(flows?.[0].amount.toFixed(2)).toBe('-1000.00');
    });

    it('returns null if a flow is not convertible', () => {
        const flows = holdingCashflows([txn({ mutation: new Decimal(-1200), mutationCurrency: 'USD' })], 'TEST');
        expect(flows).toBeNull();
    });
});

describe('cashflowWindowDays', () => {
    it('returns the number of days between the earliest and latest flow', () => {
        expect(
            cashflowWindowDays([
                { date: '2024-06-01', amount: new Decimal(1) },
                { date: '2024-01-01', amount: new Decimal(-1) },
            ]),
        ).toBe(152);
    });

    it('returns 0 with fewer than two flows', () => {
        expect(cashflowWindowDays([{ date: '2024-01-01', amount: new Decimal(-1) }])).toBe(0);
        expect(cashflowWindowDays([])).toBe(0);
    });
});

describe('portfolioCashflows', () => {
    it('includes only deposits and withdrawals, with reversed sign', () => {
        const flows = portfolioCashflows([
            txn({
                date: '2024-01-01',
                type: T.Deposit,
                isin: null,
                quantity: null,
                price: null,
                mutation: new Decimal(1000),
            }),
            txn({ date: '2024-06-01', type: T.TradeBuy, mutation: new Decimal(-500) }),
            txn({ date: '2024-07-01', type: T.Dividend, mutation: new Decimal(25) }),
            txn({
                date: '2024-12-01',
                type: T.Withdrawal,
                isin: null,
                quantity: null,
                price: null,
                mutation: new Decimal(-200),
            }),
        ]);
        expect(flows).toHaveLength(2);
        expect(flows?.[0].amount.toFixed(0)).toBe('-1000');
        expect(flows?.[1].amount.toFixed(0)).toBe('200');
    });

    it('converts non-eur deposits to reportingCurrency', () => {
        const flows = portfolioCashflows([
            txn({
                type: T.Deposit,
                isin: null,
                quantity: null,
                price: null,
                mutation: new Decimal(1200),
                mutationCurrency: 'USD',
                fxRate: new Decimal('1.2'),
            }),
        ]);
        expect(flows?.[0].amount.toFixed(2)).toBe('-1000.00');
    });

    it('returns null if an external flow is not convertible', () => {
        const flows = portfolioCashflows([
            txn({
                type: T.Deposit,
                isin: null,
                quantity: null,
                price: null,
                mutation: new Decimal(1200),
                mutationCurrency: 'USD',
            }),
        ]);
        expect(flows).toBeNull();
    });
});
