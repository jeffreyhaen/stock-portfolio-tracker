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
export function buildBenchmarkSeries(
    bars: readonly PriceBar[],
    dates: readonly string[],
    fx: FxResolver,
    reportingCurrency: string,
): BenchmarkSeries {
    const converted: { date: string; close: Decimal }[] = [];
    let missingFx = false;
    const sortedBars = [...bars].sort((a, b) => a.date.localeCompare(b.date));
    for (const bar of sortedBars) {
        const result = convertToReportingCurrency(bar.close, bar.currency, bar.date, reportingCurrency, fx);
        if (result === null) {
            missingFx = true;
            continue;
        }
        converted.push({ date: bar.date, close: result.amount });
    }

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
