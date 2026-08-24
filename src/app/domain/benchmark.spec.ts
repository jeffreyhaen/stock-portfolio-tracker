import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildBenchmarkSeries } from './benchmark';
import { FxResolver } from './fx';
import { PriceBar } from './market-value';

const eurFx: FxResolver = () => null;

function bar(date: string, close: string, currency = 'EUR'): PriceBar {
    return { date, close: new Decimal(close), currency };
}

describe('buildBenchmarkSeries', () => {
    it('emits the FX-converted close for each date from the first bar onwards', () => {
        const bars = [bar('2024-01-01', '100'), bar('2024-02-01', '110'), bar('2024-03-01', '120')];
        const dates = ['2024-01-01', '2024-02-01', '2024-03-01'];
        const series = buildBenchmarkSeries(bars, dates, eurFx, 'EUR');
        expect(series.points.map((p) => [p.date, p.close.toFixed(2)])).toEqual([
            ['2024-01-01', '100.00'],
            ['2024-02-01', '110.00'],
            ['2024-03-01', '120.00'],
        ]);
        expect(series.startDate).toBe('2024-01-01');
        expect(series.missingFx).toBe(false);
    });

    it('emits no points before the first available close', () => {
        const bars = [bar('2024-02-01', '100'), bar('2024-03-01', '110')];
        const dates = ['2024-01-15', '2024-02-01', '2024-03-01'];
        const series = buildBenchmarkSeries(bars, dates, eurFx, 'EUR');
        expect(series.points.map((p) => p.date)).toEqual(['2024-02-01', '2024-03-01']);
        expect(series.startDate).toBe('2024-02-01');
    });

    it('forward-fills closes across dates without a bar', () => {
        const bars = [bar('2024-01-01', '100'), bar('2024-01-03', '120')];
        const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
        const series = buildBenchmarkSeries(bars, dates, eurFx, 'EUR');
        expect(series.points.map((p) => p.close.toFixed(2))).toEqual(['100.00', '100.00', '120.00']);
    });

    it('uses the latest close at or before each date, regardless of bar order', () => {
        const bars = [bar('2024-01-03', '120'), bar('2024-01-01', '100')];
        const series = buildBenchmarkSeries(bars, ['2024-01-02'], eurFx, 'EUR');
        expect(series.points.map((p) => p.close.toFixed(2))).toEqual(['100.00']);
    });

    it('converts bars to the reporting currency and flags missing FX', () => {
        const fx: FxResolver = (currency) => (currency === 'USD' ? new Decimal('0.9') : null);
        const bars = [bar('2024-01-01', '100', 'USD'), bar('2024-02-01', '110', 'USD')];
        const series = buildBenchmarkSeries(bars, ['2024-01-01', '2024-02-01'], fx, 'EUR');
        expect(series.points.map((p) => p.close.toFixed(2))).toEqual(['90.00', '99.00']);
        expect(series.missingFx).toBe(false);

        const missing = buildBenchmarkSeries(bars, ['2024-01-01'], eurFx, 'EUR');
        expect(missing.points).toEqual([]);
        expect(missing.missingFx).toBe(true);
    });

    it('returns an empty series without bars or dates', () => {
        expect(buildBenchmarkSeries([], ['2024-01-01'], eurFx, 'EUR').points).toEqual([]);
        expect(buildBenchmarkSeries([bar('2024-01-01', '100')], [], eurFx, 'EUR').points).toEqual([]);
        expect(buildBenchmarkSeries([], [], eurFx, 'EUR').startDate).toBeNull();
    });
});
