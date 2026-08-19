import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { holdingPeriodDays, holdingStats } from './holdings';
import { Transaction, TransactionTypes as T } from './types';

let volgNr = 0;

function trade(overrides: Partial<Transaction>): Transaction {
    volgNr += 1;
    return {
        id: `t${volgNr}`,
        date: '2024-01-01',
        time: '10:00',
        valueDate: '2024-01-01',
        rowIndex: volgNr,
        product: 'Test stock',
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
        description: 'Koop 10 @ 100,00 EUR',
        fingerprint: `fp${volgNr}`,
        ...overrides,
    };
}

describe('holdingStats', () => {
    it('calculates quantity, net investment and first purchase for an open position', () => {
        const stats = holdingStats([
            trade({ date: '2024-01-01', quantity: new Decimal(10), mutation: new Decimal(-1000) }),
            trade({ date: '2024-02-01', quantity: new Decimal(10), mutation: new Decimal(-1200) }),
        ]);
        expect(stats).toHaveLength(1);
        expect(stats[0].quantity.toFixed(0)).toBe('20');
        expect(stats[0].netInvested?.toFixed(2)).toBe('2200.00');
        expect(stats[0].netInvestedPerShare?.toFixed(2)).toBe('110.00');
        expect(stats[0].firstBuyDate).toBe('2024-01-01');
        expect(stats[0].open).toBe(true);
        expect(stats[0].realizedPnl?.toFixed(2)).toBe('0.00');
    });

    it('consumes partial and multiple lots using FIFO', () => {
        const stats = holdingStats([
            trade({ date: '2024-01-01', quantity: new Decimal(10), mutation: new Decimal(-1000) }),
            trade({ date: '2024-02-01', quantity: new Decimal(10), mutation: new Decimal(-2000) }),
            trade({
                date: '2024-03-01',
                type: T.TradeSell,
                quantity: new Decimal(15),
                mutation: new Decimal(2700),
            }),
        ]);
        expect(stats[0].quantity.toFixed(0)).toBe('5');
        expect(stats[0].netInvested?.toFixed(2)).toBe('1000.00');
        expect(stats[0].firstBuyDate).toBe('2024-01-01');
        expect(stats[0].realizedPnl?.toFixed(2)).toBe('700.00');
        expect(stats[0].grossInvested?.toFixed(2)).toBe('3000.00');
    });

    it('reports the simple buy at 10 and sell at 20 profit', () => {
        const stats = holdingStats(
            [
                trade({ quantity: new Decimal(1), mutation: new Decimal(-10) }),
                trade({ date: '2024-02-01', type: T.TradeSell, quantity: new Decimal(1), mutation: new Decimal(20) }),
            ],
            { includeClosed: true },
        );
        expect(stats[0].realizedPnl?.toFixed(2)).toBe('10.00');
    });

    it('resets the period when the position fully closes and later reopens, realized keeps counting', () => {
        const stats = holdingStats([
            trade({ date: '2024-01-01', quantity: new Decimal(10), mutation: new Decimal(-1000) }),
            trade({
                date: '2024-02-01',
                type: T.TradeSell,
                quantity: new Decimal(10),
                mutation: new Decimal(1100),
            }),
            trade({ date: '2024-06-01', quantity: new Decimal(5), mutation: new Decimal(-700) }),
        ]);
        expect(stats).toHaveLength(1);
        expect(stats[0].quantity.toFixed(0)).toBe('5');
        expect(stats[0].netInvested?.toFixed(2)).toBe('700.00');
        expect(stats[0].firstBuyDate).toBe('2024-06-01');
        expect(stats[0].closedAt).toBeNull();
        expect(stats[0].realizedPnl?.toFixed(2)).toBe('100.00');
    });

    it('sorts by net investment descending and ignores closed positions by default', () => {
        const stats = holdingStats([
            trade({ isin: 'KLEIN', quantity: new Decimal(1), mutation: new Decimal(-10) }),
            trade({ isin: 'GROOT', quantity: new Decimal(2), mutation: new Decimal(-999) }),
            trade({ isin: 'DICHT', quantity: new Decimal(3), mutation: new Decimal(-50) }),
            trade({
                isin: 'DICHT',
                date: '2024-02-01',
                type: T.TradeSell,
                quantity: new Decimal(3),
                mutation: new Decimal(60),
            }),
        ]);
        expect(stats.map((s) => s.isin)).toEqual(['GROOT', 'KLEIN']);
    });

    it('returns closed positions with includeClosed, with realized and closeDate', () => {
        const stats = holdingStats(
            [
                trade({ isin: 'DICHT', date: '2024-01-01', quantity: new Decimal(3), mutation: new Decimal(-50) }),
                trade({
                    isin: 'DICHT',
                    date: '2024-02-01',
                    type: T.TradeSell,
                    quantity: new Decimal(3),
                    mutation: new Decimal(35),
                }),
            ],
            { includeClosed: true },
        );
        expect(stats).toHaveLength(1);
        const closed = stats[0];
        expect(closed.open).toBe(false);
        expect(closed.quantity.toFixed(0)).toBe('0');
        expect(closed.closedAt).toBe('2024-02-01');
        expect(closed.firstBuyDate).toBe('2024-01-01');
        expect(closed.netInvested).toBeNull();
        expect(closed.netInvestedPerShare).toBeNull();
        expect(closed.realizedPnl?.toFixed(2)).toBe('-15.00');
        expect(closed.grossInvested?.toFixed(2)).toBe('50.00');
    });

    it('ignores non-trade types like dividend and MMF conversions', () => {
        const stats = holdingStats([
            trade({ quantity: new Decimal(10), mutation: new Decimal(-1000) }),
            trade({ type: T.Dividend, quantity: null, mutation: new Decimal(25), isin: 'TEST' }),
            trade({ type: T.MmfConversionBuy, quantity: new Decimal(3), mutation: null }),
        ]);
        expect(stats).toHaveLength(1);
        expect(stats[0].quantity.toFixed(0)).toBe('10');
    });

    it('converts foreign currency to reportingCurrency using the transaction fx-rate', () => {
        const stats = holdingStats([
            trade({
                mutation: new Decimal(-1200),
                mutationCurrency: 'USD',
                tradeCurrency: 'USD',
                fxRate: new Decimal('1.2'),
            }),
        ]);
        expect(stats[0].netInvested?.toFixed(2)).toBe('1000.00');
        expect(stats[0].currency).toBe('USD');
        expect(stats[0].netInvestedPerShare?.toFixed(2)).toBe('100.00');
    });

    it('adds acquisition fees to basis and subtracts disposal fees from proceeds', () => {
        const orderBuy = 'aaaaaaaa-1111-1111-1111-111111111111';
        const orderSell = 'bbbbbbbb-1111-1111-1111-111111111111';
        const stats = holdingStats(
            [
                trade({ quantity: new Decimal(1), mutation: new Decimal(-10), orderId: orderBuy }),
                trade({ type: T.TransactionFee, quantity: null, mutation: new Decimal(-1), orderId: orderBuy }),
                trade({
                    date: '2024-02-01',
                    type: T.TradeSell,
                    quantity: new Decimal(1),
                    mutation: new Decimal(20),
                    orderId: orderSell,
                }),
                trade({
                    date: '2024-02-01',
                    type: T.TransactionFee,
                    quantity: null,
                    mutation: new Decimal(-2),
                    orderId: orderSell,
                }),
            ],
            { includeClosed: true },
        );
        expect(stats[0].grossInvested?.toFixed(2)).toBe('11.00');
        expect(stats[0].realizedPnl?.toFixed(2)).toBe('7.00');
    });

    it('uses linked settlement FX before transaction FX and fallback FX', () => {
        const orderId = 'cccccccc-1111-1111-1111-111111111111';
        const stats = holdingStats(
            [
                trade({
                    quantity: new Decimal(1),
                    mutation: new Decimal(-120),
                    mutationCurrency: 'USD',
                    tradeCurrency: 'USD',
                    fxRate: new Decimal(2),
                    orderId,
                }),
                trade({
                    type: T.FxDebit,
                    quantity: null,
                    mutation: new Decimal(-100),
                    mutationCurrency: 'EUR',
                    orderId,
                }),
            ],
            { fxFallback: () => new Decimal('0.5') },
        );
        expect(stats[0].netInvested?.toFixed(2)).toBe('100.00');
    });

    it('uses the fxFallback when the transaction has no fx-rate', () => {
        const stats = holdingStats(
            [trade({ mutation: new Decimal(-1200), mutationCurrency: 'USD', tradeCurrency: 'USD' })],
            { fxFallback: () => new Decimal('0.9') },
        );
        expect(stats[0].netInvested?.toFixed(2)).toBe('1080.00');
    });

    it('preserves basis through a reverse split', () => {
        const orderId = 'dddddddd-1111-1111-1111-111111111111';
        const stats = holdingStats([
            trade({ date: '2024-01-01', quantity: new Decimal(10), mutation: new Decimal(-100) }),
            trade({
                date: '2024-02-01',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(10),
                mutation: new Decimal(100),
                orderId,
            }),
            trade({
                date: '2024-02-01',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(1),
                mutation: new Decimal(-100),
                orderId,
            }),
        ]);
        expect(stats[0].quantity.toFixed()).toBe('1');
        expect(stats[0].netInvested?.toFixed(2)).toBe('100.00');
        expect(stats[0].grossInvested?.toFixed(2)).toBe('100.00');
        expect(stats[0].realizedPnl?.toFixed(2)).toBe('0.00');
        expect(stats[0].firstBuyDate).toBe('2024-01-01');
    });

    it('transfers basis to a changed product and ISIN', () => {
        const orderId = 'eeeeeeee-1111-1111-1111-111111111111';
        const stats = holdingStats([
            trade({ isin: 'OLD', product: 'Old stock', quantity: new Decimal(4), mutation: new Decimal(-80) }),
            trade({
                date: '2024-02-01',
                isin: 'OLD',
                product: 'Old stock',
                type: T.CorporateSell,
                corporateAction: 'ISIN_CHANGE',
                quantity: new Decimal(4),
                mutation: new Decimal(80),
                orderId,
            }),
            trade({
                date: '2024-02-01',
                isin: 'NEW',
                product: 'New stock',
                type: T.CorporateBuy,
                corporateAction: 'ISIN_CHANGE',
                quantity: new Decimal(4),
                mutation: new Decimal(-80),
                orderId,
            }),
        ]);
        expect(stats).toHaveLength(1);
        expect(stats[0].isin).toBe('NEW');
        expect(stats[0].product).toBe('New stock');
        expect(stats[0].netInvested?.toFixed(2)).toBe('80.00');
        expect(stats[0].firstBuyDate).toBe('2024-01-01');
    });

    it('returns null for money amounts when the fx-conversion is missing', () => {
        const stats = holdingStats([
            trade({ mutation: new Decimal(-1200), mutationCurrency: 'USD', tradeCurrency: 'USD' }),
        ]);
        expect(stats[0].netInvested).toBeNull();
        expect(stats[0].netInvestedPerShare).toBeNull();
        expect(stats[0].quantity.toFixed(0)).toBe('10');
    });
});

describe('holdingPeriodDays', () => {
    it('counts calendar days from the first purchase', () => {
        expect(holdingPeriodDays('2024-01-01', new Date(Date.UTC(2024, 0, 31)))).toBe(30);
    });
});
