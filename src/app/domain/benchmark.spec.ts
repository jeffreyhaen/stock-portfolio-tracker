import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildBenchmarkSeries, buildBenchmarkShadowSeries } from './benchmark';
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

describe('buildBenchmarkShadowSeries', () => {
    function point(date: string, flow: string): { date: string; flow: Decimal } {
        return { date, flow: new Decimal(flow) };
    }

    it('accumulates benchmark units with each external flow', () => {
        const bars = [
            bar('2020-03-03', '95'),
            bar('2020-12-01', '110'),
            bar('2021-06-01', '130'),
            bar('2026-08-01', '247'),
        ];
        const portfolio = [
            point('2020-03-03', '0.40'),
            point('2020-12-01', '10000'),
            point('2021-06-01', '5000'),
            point('2026-08-01', '0'),
        ];
        const shadow = buildBenchmarkShadowSeries(portfolio, bars, eurFx, 'EUR');
        expect(shadow.missingFx).toBe(false);
        expect(shadow.points.map((p) => p.date)).toEqual(['2020-03-03', '2020-12-01', '2021-06-01', '2026-08-01']);
        expect(shadow.points[0].value.toFixed(2)).toBe('0.40');
        expect(shadow.points[1].value.toFixed(2)).toBe('10000.46');
        expect(shadow.points[2].value.toFixed(2)).toBe('16818.73');
        expect(shadow.points[3].value.toFixed(2)).toBe('31955.59');
    });

    it('applies flows before the first benchmark close at that first close', () => {
        const bars = [bar('2024-02-01', '100')];
        const portfolio = [point('2024-01-15', '500'), point('2024-02-01', '0')];
        const shadow = buildBenchmarkShadowSeries(portfolio, bars, eurFx, 'EUR');
        expect(shadow.points.map((p) => [p.date, p.value.toFixed(2)])).toEqual([['2024-02-01', '500.00']]);
    });

    it('values flows against the forward-filled close and handles withdrawals', () => {
        const bars = [bar('2024-01-01', '100'), bar('2024-01-10', '200')];
        const portfolio = [point('2024-01-01', '1000'), point('2024-01-05', '-500'), point('2024-01-10', '0')];
        const shadow = buildBenchmarkShadowSeries(portfolio, bars, eurFx, 'EUR');
        expect(shadow.points.map((p) => p.value.toFixed(2))).toEqual(['1000.00', '500.00', '1000.00']);
    });

    it('returns no points without benchmark closes', () => {
        const shadow = buildBenchmarkShadowSeries([point('2024-01-01', '1000')], [], eurFx, 'EUR');
        expect(shadow.points).toEqual([]);
    });

    it('anchors at the given value, skipping the anchor point flow, and applies later flows', () => {
        const bars = [
            bar('2020-03-03', '95'),
            bar('2020-12-01', '110'),
            bar('2021-06-01', '130'),
            bar('2026-08-01', '247'),
        ];
        const portfolio = [
            point('2020-03-03', '0.40'),
            point('2020-12-01', '10000'),
            point('2021-06-01', '5000'),
            point('2026-08-01', '0'),
        ];
        const shadow = buildBenchmarkShadowSeries(portfolio, bars, eurFx, 'EUR', new Decimal('10200'));
        expect(shadow.points[0]).toEqual({ date: '2020-03-03', value: new Decimal('10200') });
        // anchor flow (0.40) is skipped; 10000/110 and 5000/130 units are added on top of 10200/95 units
        const units = new Decimal('10200')
            .div(95)
            .plus(new Decimal('10000').div(110))
            .plus(new Decimal('5000').div(130));
        expect(shadow.points[3].value.toFixed(2)).toBe(units.times(247).toFixed(2));
    });

    it('anchored shadow matches the unanchored shadow when the anchor is the first flow value', () => {
        const bars = [bar('2020-03-03', '95'), bar('2026-08-01', '247')];
        const portfolio = [point('2020-03-03', '1000'), point('2026-08-01', '0')];
        const anchored = buildBenchmarkShadowSeries(portfolio, bars, eurFx, 'EUR', new Decimal('1000'));
        const plain = buildBenchmarkShadowSeries(portfolio, bars, eurFx, 'EUR');
        expect(anchored.points.map((p) => p.value.toFixed(6))).toEqual(plain.points.map((p) => p.value.toFixed(6)));
    });
});
