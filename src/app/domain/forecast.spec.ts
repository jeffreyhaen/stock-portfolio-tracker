import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    FORECAST_MAX_YEARS,
    annualizedReturnPct,
    buildForecastSeries,
    forecastDate,
    forecastValidationError,
    monthlyGrowthFactor,
} from './forecast';

describe('forecast', () => {
    describe('forecastValidationError', () => {
        it('accepts usable assumptions', () => {
            expect(
                forecastValidationError({
                    principal: new Decimal('10000'),
                    annualReturnPct: new Decimal('7'),
                    monthlyContribution: new Decimal('500'),
                    years: 10,
                }),
            ).toBeNull();
        });

        it('rejects invalid horizons', () => {
            const base = {
                principal: new Decimal('1'),
                annualReturnPct: new Decimal('5'),
                monthlyContribution: new Decimal('0'),
            };
            expect(forecastValidationError({ ...base, years: 0 })).toContain('Horizon');
            expect(forecastValidationError({ ...base, years: 2.5 })).toContain('Horizon');
            expect(forecastValidationError({ ...base, years: FORECAST_MAX_YEARS + 1 })).toContain('Horizon');
        });

        it('rejects negative principal and contribution', () => {
            const base = { annualReturnPct: new Decimal('5'), monthlyContribution: new Decimal('0'), years: 5 };
            expect(forecastValidationError({ ...base, principal: new Decimal('-1') })).toContain('value');
            expect(
                forecastValidationError({
                    principal: new Decimal('1'),
                    annualReturnPct: new Decimal('5'),
                    monthlyContribution: new Decimal('-5'),
                    years: 5,
                }),
            ).toContain('contribution');
        });

        it('rejects returns outside the supported range', () => {
            const base = { principal: new Decimal('1'), monthlyContribution: new Decimal('0'), years: 5 };
            expect(forecastValidationError({ ...base, annualReturnPct: new Decimal('-100') })).toContain('return');
            expect(forecastValidationError({ ...base, annualReturnPct: new Decimal('100') })).toContain('return');
        });
    });

    describe('monthlyGrowthFactor', () => {
        it('reproduces the annual rate after twelve months', () => {
            for (const pct of ['0', '4.5', '7', '12', '-20']) {
                const factor = monthlyGrowthFactor(new Decimal(pct));
                expect(factor.pow(12).minus(1).times(100).toFixed(6)).toBe(new Decimal(pct).toFixed(6));
            }
        });
    });

    describe('forecastDate', () => {
        it('keeps the day of month and clamps to shorter months', () => {
            expect(forecastDate('2026-01-31', 1)).toBe('2026-02-28');
            expect(forecastDate('2026-01-15', 12)).toBe('2027-01-15');
            expect(forecastDate('2024-01-29', 1)).toBe('2024-02-29');
            expect(forecastDate('2026-06-30', 2)).toBe('2026-08-30');
        });
    });

    describe('buildForecastSeries', () => {
        it('starts at the principal and grows principal-only forecasts to the annual identity', () => {
            const series = buildForecastSeries(
                {
                    principal: new Decimal('10000'),
                    annualReturnPct: new Decimal('12'),
                    monthlyContribution: new Decimal('0'),
                    years: 1,
                },
                '2026-01-01',
            );
            expect(series.points).toHaveLength(13);
            expect(series.points[0].value.toFixed(2)).toBe('10000.00');
            expect(series.endValue.toFixed(2)).toBe('11200.00');
            expect(series.totalContributions.toFixed(2)).toBe('10000.00');
            expect(series.investmentGain.toFixed(2)).toBe('1200.00');
            expect(series.points[12].date).toBe('2027-01-01');
        });

        it('adds contributions after growth (ordinary annuity)', () => {
            const series = buildForecastSeries(
                {
                    principal: new Decimal('0'),
                    annualReturnPct: new Decimal('12'),
                    monthlyContribution: new Decimal('100'),
                    years: 1,
                },
                '2026-01-01',
            );
            expect(series.totalContributions.toFixed(2)).toBe('1200.00');
            expect(series.endValue.minus('1264.65').abs().lt('0.01')).toBe(true);
        });

        it('compounds exactly at 0% return: principal plus bare contributions', () => {
            const series = buildForecastSeries(
                {
                    principal: new Decimal('2500'),
                    annualReturnPct: new Decimal('0'),
                    monthlyContribution: new Decimal('100'),
                    years: 5,
                },
                '2026-01-01',
            );
            expect(series.endValue.toFixed(2)).toBe('8500.00');
            expect(series.investmentGain.toFixed(2)).toBe('0.00');
        });

        it('matches the closed-form annual growth over five years', () => {
            const series = buildForecastSeries(
                {
                    principal: new Decimal('10000'),
                    annualReturnPct: new Decimal('12'),
                    monthlyContribution: new Decimal('0'),
                    years: 5,
                },
                '2026-01-01',
            );
            expect(series.endValue.toFixed(2)).toBe('17623.42');
        });

        it('rejects invalid assumptions', () => {
            expect(() =>
                buildForecastSeries(
                    {
                        principal: new Decimal('1'),
                        annualReturnPct: new Decimal('5'),
                        monthlyContribution: new Decimal('0'),
                        years: 0,
                    },
                    '2026-01-01',
                ),
            ).toThrow(/Horizon/);
        });
    });

    describe('annualizedReturnPct', () => {
        it('annualizes multi-year growth', () => {
            const result = annualizedReturnPct(new Decimal('100'), new Decimal('200'), 730);
            expect(result !== null && result.minus('41.45').abs().lt('0.01')).toBe(true);
        });

        it('returns the raw growth rate for a one-year window', () => {
            const result = annualizedReturnPct(new Decimal('1000'), new Decimal('1070'), 365);
            expect(result !== null && result.minus('7.01').abs().lt('0.01')).toBe(true);
        });

        it('rejects short windows and non-positive values', () => {
            expect(annualizedReturnPct(new Decimal('100'), new Decimal('120'), 364)).toBeNull();
            expect(annualizedReturnPct(new Decimal('0'), new Decimal('120'), 400)).toBeNull();
            expect(annualizedReturnPct(new Decimal('100'), new Decimal('-5'), 400)).toBeNull();
        });
    });
});
