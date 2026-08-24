import Decimal from 'decimal.js';

export interface TwrInput {
    readonly date: string;
    readonly value: Decimal | null;
    readonly flow: Decimal;
}

// External flows are treated as beginning-of-day flows: r = V / (V_previous + flow) - 1.

export interface TwrResult {
    readonly twr: Decimal | null;
    readonly twrPct: Decimal | null;
    readonly days: number;
}

export interface TwrIndexPoint {
    readonly date: string;
    readonly index: Decimal;
}

/**
 * Cumulative TWR index series, starting at 100 on the first point. Uses the
 * same per-period factor as {@link timeWeightedReturn}; points without a value
 * are skipped.
 */
export function buildTwrIndexSeries(points: readonly TwrInput[]): TwrIndexPoint[] {
    const result: TwrIndexPoint[] = [];
    let index = new Decimal(100);
    let previousValue: Decimal | null = null;
    for (const point of points) {
        if (point.value === null || (point.value.isZero() && point.flow.isZero())) {
            continue;
        }
        if (previousValue !== null && !previousValue.plus(point.flow).isZero()) {
            index = index.times(point.value.div(previousValue.plus(point.flow)));
        }
        result.push({ date: point.date, index });
        previousValue = point.value;
    }
    return result;
}

export function timeWeightedReturn(points: readonly TwrInput[]): TwrResult {
    let factor = new Decimal(1);
    let previousValue: Decimal | null = null;
    let days = 0;
    for (const point of points) {
        if (point.value === null || (point.value.isZero() && point.flow.isZero())) {
            continue;
        }
        if (previousValue !== null && !previousValue.plus(point.flow).isZero()) {
            const periodReturn = point.value.div(previousValue.plus(point.flow));
            factor = factor.times(periodReturn);
            days++;
        }
        previousValue = point.value;
    }
    if (days === 0) {
        return { twr: null, twrPct: null, days };
    }
    const twr = factor.minus(1);
    return { twr, twrPct: twr.times(100), days };
}
