import Decimal from 'decimal.js';

export const PROJECTION_MAX_PROJECTED_YEARS = 10;
export const PROJECTION_MIN_PROJECTED_YEARS = 1;

/**
 * One column of the projection sheet. Index 0 of `years` is the base year:
 * it holds the last actual revenue and net income, so its growth and margin
 * are `null` while its PE columns still apply (mirrors the workbook's C column).
 */
export interface ProjectionYearInput {
    readonly year: number;
    readonly revenueGrowthPct: Decimal | null;
    readonly netMarginPct: Decimal | null;
    readonly peLow: Decimal;
    readonly peHigh: Decimal;
}

export interface ProjectionInput {
    /** Latest share price; zero disables upside and CAGR (manual/offline mode). */
    readonly currentPrice: Decimal;
    readonly sharesOutstanding: Decimal;
    readonly baseRevenue: Decimal;
    readonly baseNetIncome: Decimal;
    readonly years: readonly ProjectionYearInput[];
}

export interface ProjectionYearResult {
    readonly year: number;
    readonly revenue: Decimal;
    readonly netIncome: Decimal;
    readonly netMarginPct: Decimal;
    readonly eps: Decimal;
    readonly priceLow: Decimal;
    readonly priceHigh: Decimal;
    readonly upsideLowPct: Decimal | null;
    readonly upsideHighPct: Decimal | null;
    /** Annualized from the current price; null for the base year and the first projected year. */
    readonly cagrLowPct: Decimal | null;
    readonly cagrHighPct: Decimal | null;
}

const HUNDRED = new Decimal(100);
const GROWTH_CAP_PCT = new Decimal(1_000_000);
const MULTIPLE_CAP = new Decimal(1_000_000);

/**
 * Validates the projection inputs. Returns an English error message, or null
 * when the inputs are usable. The base year must be first and without growth
 * or margin inputs; projected years carry both.
 */
export function projectionValidationError(input: ProjectionInput): string | null {
    if (input.years.length < PROJECTION_MIN_PROJECTED_YEARS + 1) {
        return 'The projection needs at least a base year and one projected year.';
    }
    if (input.years.length > PROJECTION_MAX_PROJECTED_YEARS + 1) {
        return `The projection supports at most ${PROJECTION_MAX_PROJECTED_YEARS} projected years.`;
    }
    if (input.sharesOutstanding.lte(0)) {
        return 'Shares outstanding must be greater than zero.';
    }
    if (input.baseRevenue.lte(0)) {
        return 'Base revenue must be greater than zero.';
    }
    if (input.currentPrice.lt(0)) {
        return 'Current price cannot be negative.';
    }
    for (let i = 0; i < input.years.length; i++) {
        const year = input.years[i];
        if (i === 0) {
            if (year.revenueGrowthPct !== null || year.netMarginPct !== null) {
                return 'The base year holds actuals and cannot have growth or margin inputs.';
            }
        } else {
            if (year.revenueGrowthPct === null) {
                return `Revenue growth is missing for ${year.year}.`;
            }
            if (year.netMarginPct === null) {
                return `Net margin is missing for ${year.year}.`;
            }
            if (year.revenueGrowthPct.lte(-100) || year.revenueGrowthPct.gt(GROWTH_CAP_PCT)) {
                return `Revenue growth for ${year.year} must be between -100% and ${GROWTH_CAP_PCT.toFixed()}%.`;
            }
            if (year.netMarginPct.lte(-100) || year.netMarginPct.gte(100)) {
                return `Net margin for ${year.year} must be between -100% and 100%.`;
            }
        }
        for (const [label, pe] of [
            ['PE low', year.peLow],
            ['PE high', year.peHigh],
        ] as const) {
            if (pe.lte(0) || pe.gt(MULTIPLE_CAP)) {
                return `${label} for ${year.year} must be greater than zero.`;
            }
        }
    }
    return null;
}

/**
 * The workbook model: revenue compounds with the yearly growth input, net
 * income follows the margin input, EPS divides by shares outstanding, and the
 * PE low/high cases price the EPS. Upside compares against the current price;
 * CAGR annualizes from the current price and only appears from two projected
 * years onward.
 */
export function buildProjection(input: ProjectionInput): ProjectionYearResult[] {
    const error = projectionValidationError(input);
    if (error !== null) {
        throw new Error(error);
    }
    const hasPrice = input.currentPrice.gt(0);
    const results: ProjectionYearResult[] = [];
    let revenue = input.baseRevenue;
    for (let i = 0; i < input.years.length; i++) {
        const year = input.years[i];
        if (i === 0) {
            revenue = input.baseRevenue;
        } else {
            revenue = revenue.times(year.revenueGrowthPct!.plus(HUNDRED).div(HUNDRED));
        }
        const netIncome = i === 0 ? input.baseNetIncome : revenue.times(year.netMarginPct!.div(HUNDRED));
        const netMarginPct = netIncome.div(revenue).times(HUNDRED);
        const eps = netIncome.div(input.sharesOutstanding);
        const priceLow = year.peLow.times(eps);
        const priceHigh = year.peHigh.times(eps);
        const cagrSteps = i >= 2 ? new Decimal(i) : null;
        results.push({
            year: year.year,
            revenue,
            netIncome,
            netMarginPct,
            eps,
            priceLow,
            priceHigh,
            upsideLowPct: hasPrice ? priceLow.minus(input.currentPrice).div(input.currentPrice).times(HUNDRED) : null,
            upsideHighPct: hasPrice ? priceHigh.minus(input.currentPrice).div(input.currentPrice).times(HUNDRED) : null,
            cagrLowPct: hasPrice && cagrSteps !== null ? cagrFor(priceLow, input.currentPrice, cagrSteps) : null,
            cagrHighPct: hasPrice && cagrSteps !== null ? cagrFor(priceHigh, input.currentPrice, cagrSteps) : null,
        });
    }
    return results;
}

function cagrFor(price: Decimal, currentPrice: Decimal, steps: Decimal): Decimal {
    return price.div(currentPrice).pow(new Decimal(1).div(steps)).minus(1).times(HUNDRED);
}

export interface ProjectionScenarioRow {
    readonly revenueGrowthPct: Decimal | null;
    readonly netMarginPct: Decimal | null;
    readonly peLow: Decimal;
    readonly peHigh: Decimal;
}

export interface ProjectionScenario {
    readonly name: string;
    /** Aligned with the columns: index 0 is the base year. */
    readonly rows: readonly ProjectionScenarioRow[];
}

/** The editable, persisted projection setup for one symbol. */
export interface ProjectionModel {
    readonly symbol: string;
    readonly baseYear: number;
    readonly baseRevenue: Decimal;
    readonly baseNetIncome: Decimal;
    /** Manual override; null resolves the price live. */
    readonly currentPrice: Decimal | null;
    /** Manual override; null resolves shares live. */
    readonly sharesOutstanding: Decimal | null;
    /** ISO currency for display; '' is unknown and resolved from the proxy when available. */
    readonly currency: string;
    readonly projectedYears: number;
    readonly scenarios: readonly ProjectionScenario[];
}

/**
 * Resolves the model into calculator inputs, one per scenario: manual
 * price/share overrides win, otherwise the live fundamentals values apply.
 * A missing price becomes zero (upside/CAGR disabled); without any share
 * count the projection cannot be computed and null is returned.
 */
export function resolveProjectionInputs(
    model: ProjectionModel,
    live: { currentPrice: Decimal | null; sharesOutstanding: Decimal | null },
): ProjectionInput[] | null {
    const sharesOutstanding = model.sharesOutstanding ?? live.sharesOutstanding;
    if (sharesOutstanding === null) {
        return null;
    }
    const currentPrice = model.currentPrice ?? live.currentPrice ?? new Decimal(0);
    const baseYear = model.baseYear;
    return model.scenarios.map((scenario) => {
        const years: ProjectionYearInput[] = [];
        for (let i = 0; i < scenario.rows.length; i++) {
            const row = scenario.rows[i];
            years.push({
                year: baseYear + i,
                revenueGrowthPct: i === 0 ? null : row.revenueGrowthPct,
                netMarginPct: i === 0 ? null : row.netMarginPct,
                peLow: row.peLow,
                peHigh: row.peHigh,
            });
        }
        return {
            currentPrice,
            sharesOutstanding,
            baseRevenue: model.baseRevenue,
            baseNetIncome: model.baseNetIncome,
            years,
        };
    });
}
