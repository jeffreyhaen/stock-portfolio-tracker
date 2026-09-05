import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildProjection, projectionValidationError, ProjectionInput, ProjectionYearInput } from './projection';

const D = (value: string): Decimal => new Decimal(value);

/** Exact values from the workbook's AMD sheet (columns C..G = 2026..2030). */
const AMD_INPUT: ProjectionInput = {
    currentPrice: D('477.57'),
    sharesOutstanding: D('1632475000'),
    baseRevenue: D('46979000000'),
    baseNetIncome: D('11005499037'),
    years: [
        { year: 2026, revenueGrowthPct: null, netMarginPct: null, peLow: D('30'), peHigh: D('50') },
        ...[2027, 2028, 2029, 2030].map<ProjectionYearInput>((year) => ({
            year,
            revenueGrowthPct: D('35'),
            netMarginPct: D('35'),
            peLow: D('30'),
            peHigh: D('50'),
        })),
    ],
};

function expectDecimalClose(actual: Decimal, expected: string, tolerance: string): void {
    const difference = actual.minus(new Decimal(expected)).abs();
    expect(difference.lte(new Decimal(tolerance))).toBe(true);
}

describe('projection', () => {
    it('reproduces the workbook AMD sheet exactly', () => {
        const years = buildProjection(AMD_INPUT);

        expect(years).toHaveLength(5);

        expectDecimalClose(years[0].revenue, '46979000000', '1');
        expectDecimalClose(years[1].revenue, '63421650000', '1');
        expectDecimalClose(years[2].revenue, '85619227500', '1');
        expectDecimalClose(years[3].revenue, '115585957125', '1');
        expectDecimalClose(years[4].revenue, '156041042119', '1');

        expectDecimalClose(years[0].netIncome, '11005499037', '1');
        expectDecimalClose(years[1].netIncome, '22197577500', '1');
        expectDecimalClose(years[2].netIncome, '29966729625', '1');
        expectDecimalClose(years[3].netIncome, '40455084994', '1');
        expectDecimalClose(years[4].netIncome, '54614364742', '1');

        expectDecimalClose(years[0].eps, '6.741603416', '1e-6');
        expectDecimalClose(years[1].eps, '13.5974992', '1e-6');
        expectDecimalClose(years[2].eps, '18.35662391', '1e-6');
        expectDecimalClose(years[3].eps, '24.78144228', '1e-6');
        expectDecimalClose(years[4].eps, '33.45494708', '1e-6');

        expectDecimalClose(years[0].priceLow, '202.2481025', '1e-6');
        expectDecimalClose(years[1].priceLow, '407.9249759', '1e-6');
        expectDecimalClose(years[2].priceLow, '550.6987174', '1e-6');
        expectDecimalClose(years[3].priceLow, '743.4432685', '1e-6');
        expectDecimalClose(years[4].priceLow, '1003.648413', '1e-5');

        expectDecimalClose(years[0].priceHigh, '337.0801708', '1e-6');
        expectDecimalClose(years[4].priceHigh, '1672.747354', '1e-5');

        expectDecimalClose(years[0].upsideLowPct!, '-57.65058473', '1e-7');
        expectDecimalClose(years[4].upsideLowPct!, '110.1573408', '1e-6');
        expectDecimalClose(years[4].upsideHighPct!, '250.2622347', '1e-6');

        expect(years[0].cagrLowPct).toBeNull();
        expect(years[1].cagrLowPct).toBeNull();
        expectDecimalClose(years[2].cagrLowPct!, '7.383737064', '1e-6');
        expectDecimalClose(years[3].cagrLowPct!, '15.89648522', '1e-6');
        expectDecimalClose(years[4].cagrLowPct!, '20.40267648', '1e-6');
        expectDecimalClose(years[2].cagrHighPct!, '38.63180843', '1e-6');
        expectDecimalClose(years[4].cagrHighPct!, '36.80385279', '1e-6');

        expectDecimalClose(years[0].netMarginPct, '23.42642252', '1e-7');
        expectDecimalClose(years[1].netMarginPct, '35', '0');
    });

    it('disables upside and CAGR without a current price', () => {
        const years = buildProjection({ ...AMD_INPUT, currentPrice: D('0') });
        for (const year of years) {
            expect(year.upsideLowPct).toBeNull();
            expect(year.upsideHighPct).toBeNull();
            expect(year.cagrLowPct).toBeNull();
            expect(year.cagrHighPct).toBeNull();
        }
        expectDecimalClose(years[4].priceHigh, '1672.747354', '1e-5');
    });

    it('requires at least one projected year', () => {
        expect(projectionValidationError({ ...AMD_INPUT, years: [AMD_INPUT.years[0]] })).toContain(
            'at least a base year and one projected year',
        );
        expect(() => buildProjection({ ...AMD_INPUT, years: [AMD_INPUT.years[0]] })).toThrow();
    });

    it('rejects invalid inputs', () => {
        expect(projectionValidationError(AMD_INPUT)).toBeNull();
        expect(projectionValidationError({ ...AMD_INPUT, sharesOutstanding: D('0') })).toContain('Shares outstanding');
        expect(projectionValidationError({ ...AMD_INPUT, baseRevenue: D('0') })).toContain('Base revenue');
        expect(projectionValidationError({ ...AMD_INPUT, currentPrice: D('-1') })).toContain('negative');
        expect(
            projectionValidationError({
                ...AMD_INPUT,
                years: [AMD_INPUT.years[0], { ...AMD_INPUT.years[1], revenueGrowthPct: D('-120') }],
            }),
        ).toContain('Revenue growth');
        expect(
            projectionValidationError({
                ...AMD_INPUT,
                years: [AMD_INPUT.years[0], { ...AMD_INPUT.years[1], netMarginPct: D('100') }],
            }),
        ).toContain('Net margin');
        expect(
            projectionValidationError({
                ...AMD_INPUT,
                years: [AMD_INPUT.years[0], { ...AMD_INPUT.years[1], peLow: D('0') }],
            }),
        ).toContain('PE low');
        expect(
            projectionValidationError({
                ...AMD_INPUT,
                years: [{ ...AMD_INPUT.years[0], revenueGrowthPct: D('10') }, AMD_INPUT.years[1]],
            }),
        ).toContain('base year');
    });

    it('throws on invalid input when building', () => {
        expect(() => buildProjection({ ...AMD_INPUT, sharesOutstanding: D('0') })).toThrow();
    });
});
