import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildClosedLotViews, buildLotViews } from './lot-valuation';

const AS_OF = new Date('2026-09-02T00:00:00Z');

describe('buildLotViews', () => {
    it('values an open lot against the current per-share price', () => {
        const views = buildLotViews(
            [
                {
                    quantity: new Decimal(10),
                    basis: new Decimal('6123.50'),
                    acquiredAt: '2024-03-12',
                    basisAssumedZero: false,
                },
            ],
            new Decimal('812.40'),
            AS_OF,
        );

        expect(views).toHaveLength(1);
        const view = views[0];
        expect(view.costPerShare?.toFixed(2)).toBe('612.35');
        expect(view.value?.toFixed(2)).toBe('8124.00');
        expect(view.pnl?.toFixed(2)).toBe('2000.50');
        expect(view.pnlPct?.toFixed(2)).toBe('32.67');
        expect(view.holdingDays).toBe(904);
    });

    it('leaves value and pnl empty when no price is available', () => {
        const [view] = buildLotViews(
            [{ quantity: new Decimal(5), basis: new Decimal(100), acquiredAt: '2026-01-01', basisAssumedZero: false }],
            null,
            AS_OF,
        );

        expect(view.costPerShare?.toFixed(2)).toBe('20.00');
        expect(view.value).toBeNull();
        expect(view.pnl).toBeNull();
        expect(view.pnlPct).toBeNull();
    });

    it('keeps pnlPct empty for a zero-basis spin-off lot', () => {
        const [view] = buildLotViews(
            [{ quantity: new Decimal(2), basis: new Decimal(0), acquiredAt: '2026-01-01', basisAssumedZero: true }],
            new Decimal(50),
            AS_OF,
        );

        expect(view.value?.toFixed(2)).toBe('100.00');
        expect(view.pnl?.toFixed(2)).toBe('100.00');
        expect(view.pnlPct).toBeNull();
        expect(view.basisAssumedZero).toBe(true);
    });
});

describe('buildClosedLotViews', () => {
    it('derives realized pnl per lot match', () => {
        const views = buildClosedLotViews([
            {
                soldAt: '2024-10-15',
                soldTransactionId: 'sell-1',
                quantity: new Decimal(5),
                acquiredAt: '2024-03-12',
                basis: new Decimal('3061.75'),
                proceeds: new Decimal('3787.60'),
                basisAssumedZero: false,
            },
        ]);

        expect(views).toHaveLength(1);
        expect(views[0].pnl?.toFixed(2)).toBe('725.85');
        expect(views[0].pnlPct?.toFixed(2)).toBe('23.71');
    });

    it('keeps pnl empty when proceeds are unknown', () => {
        const [view] = buildClosedLotViews([
            {
                soldAt: '2024-10-15',
                soldTransactionId: 'sell-1',
                quantity: new Decimal(5),
                acquiredAt: '2024-03-12',
                basis: new Decimal(100),
                proceeds: null,
                basisAssumedZero: false,
            },
        ]);

        expect(view.pnl).toBeNull();
        expect(view.pnlPct).toBeNull();
    });
});
