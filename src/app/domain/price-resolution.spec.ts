import Decimal from 'decimal.js';
import { buildPriceResolver, PriceQuote } from './price-resolution';
import { Transaction, TransactionTypes as T } from './types';

function trade(overrides: Partial<Transaction> = {}): Transaction {
    return {
        id: 'trade',
        date: '2026-01-01',
        time: '10:00',
        valueDate: '2026-01-01',
        rowIndex: 0,
        product: 'Fund',
        isin: 'ISIN',
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
        fingerprint: 'trade',
        ...overrides,
    };
}

describe('buildPriceResolver', () => {
    it('uses the latest valid trade on or before the requested date', () => {
        const resolve = buildPriceResolver(
            [
                trade(),
                trade({ id: 'sell', type: T.TradeSell, date: '2026-02-01', price: new Decimal(12), rowIndex: 1 }),
            ],
            new Map(),
        );
        expect(resolve('ISIN', '2025-12-31')).toBeNull();
        expect(resolve('ISIN', '2026-01-15')?.price.toFixed()).toBe('10');
        expect(resolve('ISIN', '2026-03-01')?.price.toFixed()).toBe('12');
        expect(resolve('ISIN', '2026-03-01')?.provenance).toBe('trade');
    });

    it('always prefers a valid supplied market/manual/cache/live quote', () => {
        for (const source of ['market', 'manual', 'cache', 'live'] as const) {
            const quotes = new Map<string, PriceQuote>([['ISIN', { price: new Decimal(20), currency: 'EUR', source }]]);
            const resolved = buildPriceResolver([trade()], quotes)('ISIN', '2026-02-01');
            expect(resolved?.price.toFixed()).toBe('20');
            expect(resolved?.provenance).toBe(source);
            expect(resolved?.estimated).toBe(false);
        }
    });

    it('does not leak a dated quote into earlier valuations', () => {
        const quotes = new Map<string, PriceQuote>([
            ['ISIN', { price: new Decimal(20), currency: 'EUR', source: 'cache', date: '2026-02-01' }],
        ]);
        const resolve = buildPriceResolver([trade()], quotes);

        expect(resolve('ISIN', '2026-01-15')?.price.toFixed()).toBe('10');
        expect(resolve('ISIN', '2026-02-01')?.price.toFixed()).toBe('20');
    });

    it('ignores zero and corporate-action prices', () => {
        const corporate = trade({
            type: T.CorporateBuy,
            corporateAction: 'STOCK_SPLIT',
            price: new Decimal(100),
        });
        const zeroTrade = trade({ id: 'zero', type: T.TradeSell, price: new Decimal(0), rowIndex: 1 });
        expect(buildPriceResolver([corporate, zeroTrade], new Map())('ISIN', '2026-02-01')).toBeNull();
    });

    it('adjusts an inherited price after a same-ISIN 1:20 split', () => {
        const transactions = [
            trade({ date: '2026-01-01', quantity: new Decimal(1), price: new Decimal(1636) }),
            trade({
                id: 'split-sell',
                date: '2026-02-01',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(1),
                price: new Decimal(0),
                rowIndex: 1,
            }),
            trade({
                id: 'split-buy',
                date: '2026-02-01',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(20),
                price: new Decimal(0),
                rowIndex: 2,
            }),
        ];
        const resolve = buildPriceResolver(transactions, new Map());

        expect(resolve('ISIN', '2026-01-31')?.price.toFixed()).toBe('1636');
        expect(resolve('ISIN', '2026-02-01')?.price.toFixed()).toBe('81.8');
        expect(resolve('ISIN', '2026-02-01')?.price.times(20).toFixed()).toBe('1636');
    });

    it('carries a quantity-adjusted anchor to a changed ISIN while preserving quote precedence', () => {
        const transactions = [
            trade({ isin: 'OLD', quantity: new Decimal(4), price: new Decimal(50) }),
            trade({
                id: 'change-sell',
                isin: 'OLD',
                date: '2026-02-01',
                type: T.CorporateSell,
                corporateAction: 'ISIN_CHANGE',
                quantity: new Decimal(4),
                rowIndex: 1,
            }),
            trade({
                id: 'change-buy',
                isin: 'NEW',
                date: '2026-02-01',
                type: T.CorporateBuy,
                corporateAction: 'ISIN_CHANGE',
                quantity: new Decimal(8),
                rowIndex: 2,
            }),
        ];
        const quote = new Map<string, PriceQuote>([
            ['NEW', { price: new Decimal(30), currency: 'EUR', source: 'cache' }],
        ]);

        expect(buildPriceResolver(transactions, new Map())('NEW', '2026-01-31')).toBeNull();
        expect(buildPriceResolver(transactions, new Map())('NEW', '2026-02-01')?.price.toFixed()).toBe('25');
        expect(buildPriceResolver(transactions, quote)('NEW', '2026-02-01')?.price.toFixed()).toBe('30');
    });

    it('adjusts a synthetic reverse-split anchor across ISINs', () => {
        const oldQuantity = new Decimal(150);
        const newQuantity = new Decimal(10);
        const transactions = [
            trade({ isin: 'OLD-SHARES', date: '2024-05-13', quantity: oldQuantity, price: new Decimal(4) }),
            trade({
                id: 'split-buy',
                isin: 'NEW-SHARES',
                date: '2024-05-14',
                time: '08:32',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: newQuantity,
                rowIndex: 1,
            }),
            trade({
                id: 'split-sell',
                isin: 'OLD-SHARES',
                date: '2024-05-14',
                time: '08:29',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: oldQuantity,
                rowIndex: 2,
            }),
        ];
        const resolve = buildPriceResolver(transactions, new Map());

        expect(resolve('OLD-SHARES', '2024-05-13')?.price.toFixed()).toBe('4');
        expect(resolve('NEW-SHARES', '2024-05-13')).toBeNull();
        expect(resolve('NEW-SHARES', '2024-05-14')?.price.toFixed()).toBe('60');
        expect(resolve('NEW-SHARES', '2024-05-14')?.price.times(newQuantity).toFixed()).toBe('600');
    });
});
