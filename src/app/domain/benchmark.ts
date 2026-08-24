import Decimal from 'decimal.js';
import { convertToReportingCurrency, FxResolver } from './fx';
import { PriceBar } from './market-value';

export interface BenchmarkPoint {
    readonly date: string;
    readonly close: Decimal;
}

export interface BenchmarkSeries {
    readonly points: BenchmarkPoint[];
    readonly startDate: string | null;
    readonly missingFx: boolean;
}

/**
 * Builds the benchmark price index: closes converted to the reporting currency,
 * forward-filled over the requested `dates` (typically the portfolio series
 * dates). No points are emitted before the first available close. Price return
 * only: benchmark dividends and transaction costs are not included.
 */
function convertedCloses(
    bars: readonly PriceBar[],
    fx: FxResolver,
    reportingCurrency: string,
): { closes: { date: string; close: Decimal }[]; missingFx: boolean } {
    const closes: { date: string; close: Decimal }[] = [];
    let missingFx = false;
    const sortedBars = [...bars].sort((a, b) => a.date.localeCompare(b.date));
    for (const bar of sortedBars) {
        const result = convertToReportingCurrency(bar.close, bar.currency, bar.date, reportingCurrency, fx);
        if (result === null) {
            missingFx = true;
            continue;
        }
        closes.push({ date: bar.date, close: result.amount });
    }
    return { closes, missingFx };
}

export function buildBenchmarkSeries(
    bars: readonly PriceBar[],
    dates: readonly string[],
    fx: FxResolver,
    reportingCurrency: string,
): BenchmarkSeries {
    const { closes: converted, missingFx } = convertedCloses(bars, fx, reportingCurrency);

    const sortedDates = [...dates].sort();
    if (converted.length === 0 || sortedDates.length === 0) {
        return { points: [], startDate: null, missingFx };
    }

    const points: BenchmarkPoint[] = [];
    let barIndex = 0;
    let latest: { date: string; close: Decimal } | null = null;
    for (const date of sortedDates) {
        while (barIndex < converted.length && converted[barIndex].date <= date) {
            latest = converted[barIndex];
            barIndex++;
        }
        if (latest === null) {
            continue;
        }
        points.push({ date, close: latest.close });
    }

    return { points, startDate: points.length === 0 ? null : points[0].date, missingFx };
}

export interface BenchmarkShadowPoint {
    readonly date: string;
    readonly value: Decimal;
}

export interface BenchmarkShadowSeries {
    readonly points: BenchmarkShadowPoint[];
    readonly missingFx: boolean;
}

/**
 * Builds a fictitious shadow portfolio in the benchmark: every external
 * deposit/withdrawal of the real portfolio (in reporting currency) buys or
 * sells benchmark units at that day's close. Pass the full portfolio history,
 * not a range slice, so earlier flows are included. Flows before the first
 * available benchmark close are converted at that first close. Price return
 * only: benchmark dividends are not reinvested.
 */
export function buildBenchmarkShadowSeries(
    portfolioPoints: readonly { date: string; flow: Decimal }[],
    bars: readonly PriceBar[],
    fx: FxResolver,
    reportingCurrency: string,
): BenchmarkShadowSeries {
    const { closes, missingFx } = convertedCloses(bars, fx, reportingCurrency);
    const points: BenchmarkShadowPoint[] = [];
    if (closes.length === 0) {
        return { points, missingFx };
    }

    let barIndex = 0;
    let latestClose: Decimal | null = null;
    let units = new Decimal(0);
    let pendingFlow = new Decimal(0);
    const sorted = [...portfolioPoints].sort((a, b) => a.date.localeCompare(b.date));
    for (const point of sorted) {
        while (barIndex < closes.length && closes[barIndex].date <= point.date) {
            latestClose = closes[barIndex].close;
            barIndex++;
        }
        if (latestClose === null) {
            pendingFlow = pendingFlow.plus(point.flow);
            continue;
        }
        const flow = point.flow.plus(pendingFlow);
        pendingFlow = new Decimal(0);
        if (!flow.isZero() && latestClose.gt(0)) {
            units = units.plus(flow.dividedBy(latestClose));
        }
        points.push({ date: point.date, value: units.times(latestClose) });
    }

    return { points, missingFx };
}
