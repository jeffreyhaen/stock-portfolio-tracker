import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { accountLots } from './lot-accounting';
import { Transaction, TransactionTypes as T } from './types';

function transaction(overrides: Partial<Transaction>): Transaction {
    return {
        id: 'buy',
        date: '2024-01-01',
        time: '10:00',
        valueDate: '2024-01-01',
        rowIndex: 1,
        product: 'Test stock',
        isin: 'TEST',
        type: T.TradeBuy,
        corporateAction: null,
        quantity: new Decimal(1),
        price: new Decimal(10),
        tradeCurrency: 'EUR',
        mutation: new Decimal(-10),
        mutationCurrency: 'EUR',
        balance: null,
        balanceCurrency: null,
        fxRate: null,
        orderId: null,
        description: '',
        fingerprint: 'buy',
        ...overrides,
    };
}

describe('accountLots', () => {
    it('clamps oversells and emits a diagnostic', () => {
        const result = accountLots([
            transaction({}),
            transaction({
                id: 'sell',
                fingerprint: 'sell',
                date: '2024-02-01',
                rowIndex: 2,
                type: T.TradeSell,
                quantity: new Decimal(2),
                mutation: new Decimal(40),
            }),
        ]);
        expect(result.positions.get('TEST')?.lots).toHaveLength(0);
        expect(result.positions.get('TEST')?.realizedPnl).toBeNull();
        expect(result.positions.get('TEST')?.realizedComplete).toBe(false);
        expect(result.positions.get('TEST')?.accountingComplete).toBe(false);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].kind).toBe('OVERSELL');
        expect(result.diagnostics[0].quantity?.toFixed()).toBe('1');
    });

    it('uses broker monetary basis for a buy-only spin-off when supplied', () => {
        const result = accountLots([
            transaction({
                type: T.CorporateBuy,
                corporateAction: 'SPIN_OFF',
                quantity: new Decimal(3),
                mutation: new Decimal(-45),
            }),
        ]);
        const position = result.positions.get('TEST');

        expect(position?.lots[0]?.quantity.toFixed()).toBe('3');
        expect(position?.lots[0]?.basis.toFixed()).toBe('45');
        expect(position?.accountingComplete).toBe(true);
        expect(result.diagnostics).toEqual([]);
    });

    it('calculates realized P&L from zero for a buy-only zero-cash spin-off lot', () => {
        const result = accountLots([
            transaction({
                id: 'spin-off',
                fingerprint: 'spin-off',
                type: T.CorporateBuy,
                corporateAction: 'SPIN_OFF',
                quantity: new Decimal(3),
                mutation: new Decimal(0),
            }),
            transaction({
                id: 'sell',
                fingerprint: 'sell',
                date: '2024-02-01',
                rowIndex: 2,
                type: T.TradeSell,
                quantity: new Decimal(3),
                mutation: new Decimal('48.25'),
            }),
        ]);
        const position = result.positions.get('TEST');

        expect(position?.basisComplete).toBe(false);
        expect(position?.realizedComplete).toBe(true);
        expect(position?.realizedPnl?.toFixed(2)).toBe('48.25');
        expect(position?.realizedBasisAssumedZero).toBe(true);
        expect(position?.accountingComplete).toBe(false);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({ kind: 'MISSING_CORPORATE_ACTION_BASIS', quantity: new Decimal(3) }),
        ]);
    });

    it('keeps a buy-only zero-cash unknown corporate action realized-unavailable', () => {
        const result = accountLots([
            transaction({
                type: T.CorporateBuy,
                corporateAction: 'PRODUCT_CHANGE',
                quantity: new Decimal(3),
                mutation: new Decimal(0),
            }),
        ]);
        const position = result.positions.get('TEST');

        expect(position?.realizedPnl).toBeNull();
        expect(position?.realizedComplete).toBe(false);
        expect(position?.realizedBasisAssumedZero).toBe(false);
    });

    it('does not guess an order when fallback fee association is ambiguous', () => {
        const firstOrder = 'aaaaaaaa-1111-1111-1111-111111111111';
        const secondOrder = 'bbbbbbbb-1111-1111-1111-111111111111';
        const result = accountLots([
            transaction({ id: 'first', quantity: new Decimal(1), mutation: new Decimal(-10), orderId: firstOrder }),
            transaction({
                id: 'second',
                quantity: new Decimal(1),
                mutation: new Decimal(-20),
                orderId: secondOrder,
                rowIndex: 2,
            }),
            transaction({
                id: 'tax',
                type: T.TransactionTax,
                quantity: null,
                mutation: new Decimal(-3),
                orderId: null,
                rowIndex: 3,
            }),
        ]);

        expect(result.positions.get('TEST')?.grossInvested.toFixed()).toBe('30');
    });

    it('uses row order deterministically for trades at the same date and time', () => {
        const result = accountLots([
            transaction({ id: 'sell', fingerprint: 'sell', rowIndex: 1, type: T.TradeSell, mutation: new Decimal(20) }),
            transaction({ id: 'buy', fingerprint: 'buy', rowIndex: 2 }),
        ]);
        expect(result.positions.get('TEST')?.realizedPnl?.toFixed(2)).toBe('10.00');
        expect(result.diagnostics).toHaveLength(0);
    });

    it('merges transferred corporate-action lots in FIFO acquisition order', () => {
        const result = accountLots([
            transaction({ id: 'old-buy', isin: 'OLD', date: '2023-01-01', mutation: new Decimal(-10) }),
            transaction({ id: 'new-buy', isin: 'NEW', date: '2024-01-01', mutation: new Decimal(-100) }),
            transaction({
                id: 'old-out',
                isin: 'OLD',
                date: '2025-01-01',
                type: T.CorporateSell,
                corporateAction: 'ISIN_CHANGE',
                mutation: new Decimal(0),
                rowIndex: 2,
            }),
            transaction({
                id: 'new-in',
                isin: 'NEW',
                date: '2025-01-01',
                type: T.CorporateBuy,
                corporateAction: 'ISIN_CHANGE',
                mutation: new Decimal(0),
                rowIndex: 1,
            }),
            transaction({
                id: 'new-sell',
                isin: 'NEW',
                date: '2026-01-01',
                type: T.TradeSell,
                mutation: new Decimal(150),
            }),
        ]);

        expect(result.positions.get('NEW')?.realizedPnl?.toFixed()).toBe('140');
        expect(result.positions.get('NEW')?.lots[0]?.basis.toFixed()).toBe('100');
    });

    it('marks a source-only corporate action incomplete', () => {
        const result = accountLots([
            transaction({ id: 'buy' }),
            transaction({
                id: 'source-only',
                date: '2025-01-01',
                type: T.CorporateSell,
                corporateAction: 'ISIN_CHANGE',
                mutation: new Decimal(0),
            }),
        ]);

        expect(result.positions.get('TEST')?.accountingComplete).toBe(false);
        expect(result.positions.get('TEST')?.realizedPnl).toBeNull();
        expect(result.diagnostics.some((diagnostic) => diagnostic.kind === 'UNMATCHED_CORPORATE_ACTION')).toBe(true);
    });
});
