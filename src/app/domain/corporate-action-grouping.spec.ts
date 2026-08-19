import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { accountLots } from './lot-accounting';
import { buildPriceResolver } from './price-resolution';
import { groupCorporateActions } from './corporate-action-grouping';
import { Transaction, TransactionTypes as T } from './types';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
    return {
        id: 'transaction',
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
        fingerprint: 'transaction',
        ...overrides,
    };
}

describe('groupCorporateActions', () => {
    it('separates two no-order-id split pairs on the same day', () => {
        const actions = [
            transaction({
                id: 'first-sell',
                date: '2026-02-01',
                time: '09:00',
                rowIndex: 1,
                isin: 'OLD-1',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(10),
            }),
            transaction({
                id: 'first-buy',
                date: '2026-02-01',
                time: '09:01',
                rowIndex: 2,
                isin: 'NEW-1',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(20),
            }),
            transaction({
                id: 'second-sell',
                date: '2026-02-01',
                time: '09:02',
                rowIndex: 3,
                isin: 'OLD-2',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(10),
            }),
            transaction({
                id: 'second-buy',
                date: '2026-02-01',
                time: '09:03',
                rowIndex: 4,
                isin: 'NEW-2',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(20),
            }),
        ];

        expect(groupCorporateActions(actions).map((group) => group.rows.map((row) => row.id))).toEqual([
            ['first-sell', 'first-buy'],
            ['second-sell', 'second-buy'],
        ]);
    });

    it('keeps ambiguous side blocks together so accounting cannot cross-pair ISINs', () => {
        const actions = [
            transaction({
                id: 'sell-a',
                isin: 'OLD-A',
                type: T.CorporateSell,
                corporateAction: 'ISIN_CHANGE',
                rowIndex: 4,
            }),
            transaction({
                id: 'sell-b',
                isin: 'OLD-B',
                type: T.CorporateSell,
                corporateAction: 'ISIN_CHANGE',
                rowIndex: 3,
            }),
            transaction({
                id: 'buy-a',
                isin: 'NEW-A',
                type: T.CorporateBuy,
                corporateAction: 'ISIN_CHANGE',
                rowIndex: 2,
            }),
            transaction({
                id: 'buy-b',
                isin: 'NEW-B',
                type: T.CorporateBuy,
                corporateAction: 'ISIN_CHANGE',
                rowIndex: 1,
            }),
        ];

        const groups = groupCorporateActions(actions);
        const accounting = accountLots([
            transaction({ id: 'old-a', isin: 'OLD-A', date: '2025-01-01' }),
            transaction({ id: 'old-b', isin: 'OLD-B', date: '2025-01-01' }),
            ...actions,
        ]);

        expect(groups).toHaveLength(1);
        expect(accounting.diagnostics.some((diagnostic) => diagnostic.kind === 'UNMATCHED_CORPORATE_ACTION')).toBe(
            true,
        );
        expect(accounting.positions.get('NEW-A')?.accountingComplete).toBe(false);
        expect(accounting.positions.get('NEW-B')?.accountingComplete).toBe(false);
    });

    it('keeps contiguous sell fills and buy fills in one group', () => {
        const actions = [
            transaction({
                id: 'sell-1',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                rowIndex: 1,
            }),
            transaction({
                id: 'sell-2',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                rowIndex: 2,
            }),
            transaction({
                id: 'buy-1',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                rowIndex: 3,
            }),
            transaction({
                id: 'buy-2',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                rowIndex: 4,
            }),
        ];

        expect(groupCorporateActions(actions).map((group) => group.rows.map((row) => row.id))).toEqual([
            ['buy-2', 'buy-1', 'sell-2', 'sell-1'],
        ]);
    });

    it('supports buy-then-sell fills and starts a new unrelated group on the third side run', () => {
        const actions = [
            transaction({ id: 'buy-1', type: T.CorporateBuy, corporateAction: 'PRODUCT_CHANGE', rowIndex: 1 }),
            transaction({ id: 'buy-2', type: T.CorporateBuy, corporateAction: 'PRODUCT_CHANGE', rowIndex: 2 }),
            transaction({ id: 'sell-1', type: T.CorporateSell, corporateAction: 'PRODUCT_CHANGE', rowIndex: 3 }),
            transaction({ id: 'sell-2', type: T.CorporateSell, corporateAction: 'PRODUCT_CHANGE', rowIndex: 4 }),
            transaction({ id: 'buy-next', type: T.CorporateBuy, corporateAction: 'PRODUCT_CHANGE', rowIndex: 5 }),
            transaction({ id: 'sell-next', type: T.CorporateSell, corporateAction: 'PRODUCT_CHANGE', rowIndex: 6 }),
        ];

        expect(groupCorporateActions(actions).map((group) => group.rows.map((row) => row.id))).toEqual([
            ['sell-next', 'buy-next'],
            ['sell-2', 'sell-1', 'buy-2', 'buy-1'],
        ]);
    });

    it('keeps a synthetic reverse-split pair together despite different times and ISINs', () => {
        const actions = [
            transaction({
                id: 'split-buy',
                date: '2024-05-14',
                time: '08:32',
                rowIndex: 1,
                isin: 'NEW-SHARES',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(10),
            }),
            transaction({
                id: 'split-sell',
                date: '2024-05-14',
                time: '08:29',
                rowIndex: 2,
                isin: 'OLD-SHARES',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(150),
            }),
        ];

        expect(groupCorporateActions(actions).map((group) => group.rows.map((row) => row.id))).toEqual([
            ['split-sell', 'split-buy'],
        ]);
    });

    it('keeps a synthetic buy-then-sell product change together for accounting', () => {
        const oldBuy = transaction({ id: 'old-buy', isin: 'OLD-FUND', date: '2023-01-01', quantity: new Decimal(25) });
        const actions = [
            transaction({
                id: 'change-buy',
                isin: 'NEW-FUND',
                type: T.CorporateBuy,
                corporateAction: 'PRODUCT_CHANGE',
                quantity: new Decimal(25),
                rowIndex: 1,
            }),
            transaction({
                id: 'change-sell',
                isin: 'OLD-FUND',
                type: T.CorporateSell,
                corporateAction: 'PRODUCT_CHANGE',
                quantity: new Decimal(25),
                rowIndex: 2,
            }),
        ];
        const group = groupCorporateActions(actions)[0];

        expect(group.rows.map((row) => [row.type, row.quantity?.toFixed()])).toEqual([
            [T.CorporateSell, '25'],
            [T.CorporateBuy, '25'],
        ]);
        expect(
            accountLots([oldBuy, ...actions]).diagnostics.filter(
                (entry) => entry.kind === 'UNMATCHED_CORPORATE_ACTION',
            ),
        ).toEqual([]);
    });

    it('uses the same split pairs for lot basis and price anchors', () => {
        const transactions = [
            transaction({
                id: 'old-1-buy',
                isin: 'OLD-1',
                quantity: new Decimal(10),
                price: new Decimal(10),
                mutation: new Decimal(-100),
            }),
            transaction({
                id: 'old-2-buy',
                isin: 'OLD-2',
                quantity: new Decimal(10),
                price: new Decimal(40),
                mutation: new Decimal(-400),
                rowIndex: 1,
            }),
            transaction({
                id: 'first-sell',
                date: '2026-02-01',
                time: '09:00',
                rowIndex: 2,
                isin: 'OLD-1',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(10),
            }),
            transaction({
                id: 'first-buy',
                date: '2026-02-01',
                time: '09:01',
                rowIndex: 3,
                isin: 'NEW-1',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(20),
            }),
            transaction({
                id: 'second-sell',
                date: '2026-02-01',
                time: '09:02',
                rowIndex: 4,
                isin: 'OLD-2',
                type: T.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(10),
            }),
            transaction({
                id: 'second-buy',
                date: '2026-02-01',
                time: '09:03',
                rowIndex: 5,
                isin: 'NEW-2',
                type: T.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(20),
            }),
        ];
        const lots = accountLots(transactions);
        const resolve = buildPriceResolver(transactions, new Map());

        expect(lots.positions.get('NEW-1')?.lots[0]?.basis.toFixed()).toBe('100');
        expect(lots.positions.get('NEW-2')?.lots[0]?.basis.toFixed()).toBe('400');
        expect(resolve('NEW-1', '2026-02-01')?.price.toFixed()).toBe('5');
        expect(resolve('NEW-2', '2026-02-01')?.price.toFixed()).toBe('20');
    });
});
