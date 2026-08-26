import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { mergeSplitExecutions } from './split-execution-merge';
import { Transaction, TransactionTypes as T } from './types';

function transaction(overrides: Partial<Transaction>): Transaction {
    return {
        id: 'row',
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
        orderId: 'order-1',
        description: '',
        fingerprint: 'row',
        ...overrides,
    };
}

function fill(rowIndex: number, quantity: number, price: number): Transaction {
    return transaction({
        id: `fill-${rowIndex}`,
        fingerprint: `fill-${rowIndex}`,
        rowIndex,
        time: `10:0${rowIndex}`,
        quantity: new Decimal(quantity),
        price: new Decimal(price),
        mutation: new Decimal(quantity).times(price).neg(),
        balance: new Decimal(1000).minus(new Decimal(quantity).times(price)),
        balanceCurrency: 'EUR',
    });
}

describe('mergeSplitExecutions', () => {
    it('merges fills of the same order into one transaction with vwap price', () => {
        const result = mergeSplitExecutions([fill(1, 1, 397.73), fill(2, 24, 397.97)]);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('merged:order-1:TRADE_BUY:TEST');
        expect(result[0].quantity?.toFixed()).toBe('25');
        expect(result[0].price?.toFixed(4)).toBe('397.9604');
        expect(result[0].mutation?.toFixed(2)).toBe('-9949.01');
        expect(result[0].rowIndex).toBe(1);
        expect(result[0].time).toBe('10:01');
        expect(result[0].balance?.toFixed(2)).toBe('-8551.28');
    });

    it('keeps buys and sells of the same order separate', () => {
        const rows = [
            fill(1, 1, 10),
            transaction({
                ...fill(2, 2, 12),
                type: T.TradeSell,
                mutation: new Decimal(24),
            }),
        ];
        expect(mergeSplitExecutions(rows)).toHaveLength(2);
    });

    it('keeps different orders and different isins separate', () => {
        const rows = [fill(1, 1, 10), transaction({ ...fill(2, 2, 12), orderId: 'order-2' })];
        expect(mergeSplitExecutions(rows)).toHaveLength(2);
        const otherIsin = [fill(1, 1, 10), transaction({ ...fill(2, 2, 12), isin: 'OTHER' })];
        expect(mergeSplitExecutions(otherIsin)).toHaveLength(2);
    });

    it('does not merge single fills, corporate rows, or rows with missing money', () => {
        expect(mergeSplitExecutions([fill(1, 1, 10)])).toHaveLength(1);
        const corporate = [
            transaction({ ...fill(1, 1, 10), type: T.CorporateBuy, corporateAction: 'SPIN_OFF' }),
            transaction({ ...fill(2, 2, 12), type: T.CorporateBuy, corporateAction: 'SPIN_OFF' }),
        ];
        expect(mergeSplitExecutions(corporate)).toHaveLength(2);
        const missingMoney = [fill(1, 1, 10), transaction({ ...fill(2, 2, 12), mutation: null })];
        expect(mergeSplitExecutions(missingMoney)).toHaveLength(2);
    });

    it('keeps non-trade rows in order and computes a weighted fx rate', () => {
        const rows = [
            fill(1, 1, 100),
            transaction({ id: 'fx', fingerprint: 'fx', rowIndex: 2, type: T.FxDebit, isin: null, orderId: null }),
            transaction({ ...fill(3, 3, 100), fxRate: new Decimal(1.1) }),
        ];
        const withFx = [
            transaction({ ...fill(1, 1, 100), fxRate: new Decimal(1.2) }),
            transaction({
                ...fill(2, 3, 200),
                mutation: new Decimal(-600),
                fxRate: new Decimal(1.1),
            }),
        ];
        expect(mergeSplitExecutions(rows)).toHaveLength(3);
        expect(mergeSplitExecutions(rows)[1].type).toBe(T.FxDebit);
        const merged = mergeSplitExecutions(withFx);
        expect(merged).toHaveLength(1);
        expect(merged[0].fxRate?.toFixed(4)).toBe('1.1133');
    });

    it('does not merge fills with mixed fx rate presence', () => {
        const rows = [fill(1, 1, 100), transaction({ ...fill(2, 3, 100), fxRate: new Decimal(1.1) })];
        expect(mergeSplitExecutions(rows)).toHaveLength(2);
    });
});
