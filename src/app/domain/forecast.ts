import Decimal from 'decimal.js';

export interface ForecastAssumptions {
    readonly principal: Decimal;
    readonly annualReturnPct: Decimal;
    readonly monthlyContribution: Decimal;
    readonly years: number;
}

export interface ForecastPoint {
    readonly date: string;
    readonly value: Decimal;
}

export interface ForecastSeries {
    readonly points: ForecastPoint[];
    readonly endValue: Decimal;
    readonly totalContributions: Decimal;
    readonly investmentGain: Decimal;
    readonly months: number;
}

export const FORECAST_MAX_YEARS = 50;

/**
 * Validates forecast assumptions. Returns an English error message, or null
 * when the assumptions are usable. Nominal values in the reporting currency;
 * contributions are applied monthly after growth.
 */
export function forecastValidationError(assumptions: ForecastAssumptions): string | null {
    if (!Number.isInteger(assumptions.years) || assumptions.years < 1 || assumptions.years > FORECAST_MAX_YEARS) {
        return `Horizon must be a whole number between 1 and ${FORECAST_MAX_YEARS} years.`;
    }
    if (assumptions.principal.isNegative()) {
        return 'Current value cannot be negative.';
    }
    if (assumptions.monthlyContribution.isNegative()) {
        return 'Monthly contribution cannot be negative.';
    }
    if (assumptions.annualReturnPct.lte(-100) || assumptions.annualReturnPct.gte(100)) {
        return 'Annual return must be between -100% and 100%.';
    }
    return null;
}

/**
 * Monthly equivalent of the annual return: (1 + annual)^(1/12), so twelve
 * months of compounding reproduce the annual rate exactly.
 */
export function monthlyGrowthFactor(annualReturnPct: Decimal): Decimal {
    return annualReturnPct.div(100).plus(1).pow(new Decimal(1).div(12));
}

/** The date `months` after `startDate`, clamped to the end of shorter months. */
export function forecastDate(startDate: string, months: number): string {
    const [year, month, day] = startDate.split('-').map(Number);
    const target = new Date(Date.UTC(year, month - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    const clampedDay = Math.min(day, lastDay);
    const iso = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clampedDay))
        .toISOString()
        .slice(0, 10);
    return iso;
}

/**
 * Monthly compounded forecast series. Point 0 is the principal at `startDate`;
 * every following point is one month later with growth applied first and the
 * monthly contribution added after, matching ordinary annuity conventions.
 */
export function buildForecastSeries(assumptions: ForecastAssumptions, startDate: string): ForecastSeries {
    const error = forecastValidationError(assumptions);
    if (error !== null) {
        throw new Error(error);
    }
    const months = assumptions.years * 12;
    const factor = monthlyGrowthFactor(assumptions.annualReturnPct);
    const points: ForecastPoint[] = [{ date: startDate, value: assumptions.principal }];
    let balance = assumptions.principal;
    for (let month = 1; month <= months; month++) {
        balance = balance.times(factor).plus(assumptions.monthlyContribution);
        points.push({ date: forecastDate(startDate, month), value: balance });
    }
    const totalContributions = assumptions.principal.plus(assumptions.monthlyContribution.times(months));
    return {
        points,
        endValue: balance,
        totalContributions,
        investmentGain: balance.minus(totalContributions),
        months,
    };
}

/**
 * Annualized return (CAGR) between two values observed `days` apart.
 * Returns null below one year: annualizing shorter periods is misleading.
 */
export function annualizedReturnPct(first: Decimal, last: Decimal, days: number): Decimal | null {
    if (first.lte(0) || last.lte(0) || days < 365) {
        return null;
    }
    const years = new Decimal(days).div(365.25);
    return last.div(first).pow(new Decimal(1).div(years)).minus(1).times(100);
}
