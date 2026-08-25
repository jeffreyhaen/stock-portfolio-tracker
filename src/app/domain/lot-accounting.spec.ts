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

    it('records a closed lot match per consumed FIFO fragment', () => {
        const result = accountLots([
            transaction({ id: 'buy-1', quantity: new Decimal(5), mutation: new Decimal(-50) }),
            transaction({
                id: 'buy-2',
                date: '2024-02-01',
                quantity: new Decimal(5),
                mutation: new Decimal(-70),
                rowIndex: 2,
            }),
            transaction({
                id: 'sell',
                date: '2024-03-01',
                type: T.TradeSell,
                quantity: new Decimal(7),
                mutation: new Decimal(105),
                rowIndex: 3,
            }),
        ]);

        const position = result.positions.get('TEST');
        expect(position?.closedLots).toHaveLength(2);
        const [first, second] = position?.closedLots ?? [];
        expect(first.soldAt).toBe('2024-03-01');
        expect(first.soldTransactionId).toBe('sell');
        expect(first.quantity.toFixed()).toBe('5');
        expect(first.acquiredAt).toBe('2024-01-01');
        expect(first.basis.toFixed(2)).toBe('50.00');
        expect(first.proceeds?.toFixed(2)).toBe('75.00');
        expect(second.quantity.toFixed()).toBe('2');
        expect(second.acquiredAt).toBe('2024-02-01');
        expect(second.basis.toFixed(2)).toBe('28.00');
        expect(second.proceeds?.toFixed(2)).toBe('30.00');
        const proceedsTotal = (first.proceeds ?? new Decimal(0)).plus(second.proceeds ?? 0);
        expect(proceedsTotal.toFixed(2)).toBe('105.00');
        expect(position?.realizedPnl?.toFixed(2)).toBe('27.00');
    });

    it('keeps closed lot proceeds empty when sale money is missing', () => {
        const result = accountLots([
            transaction({ id: 'buy' }),
            transaction({
                id: 'sell',
                date: '2024-03-01',
                type: T.TradeSell,
                mutation: null,
                mutationCurrency: null,
                rowIndex: 2,
            }),
        ]);

        const [match] = result.positions.get('TEST')?.closedLots ?? [];
        expect(match.quantity.toFixed()).toBe('1');
        expect(match.basis.toFixed(2)).toBe('10.00');
        expect(match.proceeds).toBeNull();
    });

    it('does not record closed lots for corporate-action transfers', () => {
        const result = accountLots([
            transaction({ id: 'old-buy', isin: 'OLD', date: '2023-01-01', mutation: new Decimal(-10) }),
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
        ]);

        expect(result.positions.get('OLD')?.closedLots).toHaveLength(0);
        expect(result.positions.get('NEW')?.closedLots).toHaveLength(0);
    });

    it('merges split executions of the same order into a single lot', () => {
        const result = accountLots([
            transaction({ id: 'fill-1', fingerprint: 'fill-1', orderId: 'order-1', mutation: new Decimal(-397.73) }),
            transaction({
                id: 'fill-2',
                fingerprint: 'fill-2',
                orderId: 'order-1',
                rowIndex: 2,
                time: '10:01',
                quantity: new Decimal(24),
                price: new Decimal(397.97),
                mutation: new Decimal(-9551.28),
            }),
            transaction({
                id: 'fee',
                fingerprint: 'fee',
                rowIndex: 3,
                time: '10:01',
                type: T.TransactionFee,
                isin: null,
                quantity: null,
                price: null,
                orderId: 'order-1',
                mutation: new Decimal(-1),
            }),
        ]);

        const position = result.positions.get('TEST');
        expect(position?.lots).toHaveLength(1);
        expect(position?.lots[0].quantity.toFixed()).toBe('25');
        expect(position?.lots[0].basis.toFixed(2)).toBe('9950.01');
        expect(result.diagnostics).toHaveLength(0);
    });

    it('consumes the newest lot first with the lifo strategy', () => {
        const rows = [
            transaction({ id: 'buy-old', fingerprint: 'buy-old' }),
            transaction({
                id: 'buy-new',
                fingerprint: 'buy-new',
                date: '2024-06-01',
                rowIndex: 2,
                price: new Decimal(20),
                mutation: new Decimal(-20),
            }),
            transaction({
                id: 'sell',
                fingerprint: 'sell',
                date: '2024-07-01',
                rowIndex: 3,
                type: T.TradeSell,
                price: new Decimal(25),
                mutation: new Decimal(25),
            }),
        ];

        const fifo = accountLots(rows);
        expect(fifo.positions.get('TEST')?.lots[0].acquiredAt).toBe('2024-06-01');
        expect(fifo.positions.get('TEST')?.realizedPnl?.toFixed(2)).toBe('15.00');
        expect(fifo.positions.get('TEST')?.closedLots[0].acquiredAt).toBe('2024-01-01');

        const lifo = accountLots(rows, { strategy: 'lifo' });
        expect(lifo.positions.get('TEST')?.lots[0].acquiredAt).toBe('2024-01-01');
        expect(lifo.positions.get('TEST')?.realizedPnl?.toFixed(2)).toBe('5.00');
        expect(lifo.positions.get('TEST')?.closedLots[0].acquiredAt).toBe('2024-06-01');
    });
});
