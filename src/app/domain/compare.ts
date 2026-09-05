import Decimal from 'decimal.js';
import { FundamentalsResult } from '../data/market-data-provider';

/** One compare column: a symbol with its (optional) fundamentals and latest price. */
export interface CompareColumn {
    readonly symbol: string;
    readonly longName: string | null;
    readonly currency: string;
    /** Latest price in the symbol's own currency; used for the next-year forward P/E. */
    readonly price: string | null;
    readonly fundamentals: FundamentalsResult | null;
}

export type MetricFormat = 'pct' | 'ratio' | 'ratio2' | 'cap';

export interface CompareMetricRow {
    readonly key: string;
    readonly label: string;
    readonly format: MetricFormat;
    /** Optional explanation shown as a tooltip on the label. */
    readonly hint: string | null;
    /** One formatted display string (or null → “–”) per column. */
    readonly values: (string | null)[];
}

export interface CompareGroup {
    readonly key: string;
    readonly label: string;
    readonly rows: CompareMetricRow[];
}

function decimalOrNull(value: string | null | undefined): Decimal | null {
    if (value === null || value === undefined || value.trim() === '') {
        return null;
    }
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
}

function positive(value: string | null | undefined): Decimal | null {
    const decimal = decimalOrNull(value);
    return decimal !== null && decimal.isPositive() ? decimal : null;
}

/** Derived metrics that Yahoo does not report directly; every metric is null when it cannot be computed. */
export interface DerivedCompareMetrics {
    /** Last fiscal year net income growth vs the prior year: (fy − fyPrev) / |fyPrev|. */
    readonly lastYearEarningsGrowth: Decimal | null;
    /** Implied EPS growth from trailing EPS to next-FY consensus EPS. */
    readonly ttmToNtmEpsGrowth: Decimal | null;
    /** (1 + current-FY EPS growth) × (1 + next-FY EPS growth) − 1. */
    readonly twoYearEpsGrowthStack: Decimal | null;
    /** price / next-FY consensus EPS. */
    readonly nextYearForwardPe: Decimal | null;
    /** Trailing P/E divided by next-FY expected EPS growth in percent. */
    readonly pegForward: Decimal | null;
    /** market cap / next-FY consensus revenue. */
    readonly forwardPriceToSales: Decimal | null;
}

const ONE = new Decimal(1);
const HUNDRED = new Decimal(100);

export function deriveCompareMetrics(fundamentals: FundamentalsResult, price: string | null): DerivedCompareMetrics {
    const netIncomeFy = decimalOrNull(fundamentals.netIncomeFy);
    const netIncomeFyPrev = decimalOrNull(fundamentals.netIncomeFyPrev);
    const lastYearEarningsGrowth =
        netIncomeFy !== null && netIncomeFyPrev !== null && !netIncomeFyPrev.isZero()
            ? netIncomeFy.minus(netIncomeFyPrev).dividedBy(netIncomeFyPrev.abs())
            : null;

    const epsTtm = positive(fundamentals.epsTtm);
    const epsEstimateNextFy = positive(fundamentals.estimates.epsEstimateNextFy);
    const ttmToNtmEpsGrowth =
        epsTtm !== null && epsEstimateNextFy !== null ? epsEstimateNextFy.dividedBy(epsTtm).minus(ONE) : null;

    const growthCurrentFy = decimalOrNull(fundamentals.estimates.epsGrowthCurrentFy);
    const growthNextFy = decimalOrNull(fundamentals.estimates.epsGrowthNextFy);
    const twoYearEpsGrowthStack =
        growthCurrentFy !== null && growthNextFy !== null
            ? growthCurrentFy.plus(ONE).times(growthNextFy.plus(ONE)).minus(ONE)
            : null;

    const priceDecimal = positive(price);
    const nextYearForwardPe =
        priceDecimal !== null && epsEstimateNextFy !== null ? priceDecimal.dividedBy(epsEstimateNextFy) : null;

    const peTtm = positive(fundamentals.peTtm);
    const pegForward =
        peTtm !== null && growthNextFy !== null && growthNextFy.isPositive()
            ? peTtm.dividedBy(growthNextFy.times(HUNDRED))
            : null;

    const marketCap = positive(fundamentals.marketCap);
    const revenueEstimateNextFy = positive(fundamentals.estimates.revenueEstimateNextFy);
    const forwardPriceToSales =
        marketCap !== null && revenueEstimateNextFy !== null ? marketCap.dividedBy(revenueEstimateNextFy) : null;

    return {
        lastYearEarningsGrowth,
        ttmToNtmEpsGrowth,
        twoYearEpsGrowthStack,
        nextYearForwardPe,
        pegForward,
        forwardPriceToSales,
    };
}

const percentFormat = new Intl.NumberFormat('nl-NL', {
    style: 'percent',
    maximumFractionDigits: 1,
});
const ratioFormat = new Intl.NumberFormat('nl-NL', {
    maximumFractionDigits: 1,
});
const ratio2Format = new Intl.NumberFormat('nl-NL', {
    maximumFractionDigits: 2,
});
const capFormat = (currency: string): Intl.NumberFormat =>
    new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency,
        currencyDisplay: currency === 'USD' ? 'narrowSymbol' : 'symbol',
        notation: 'compact',
        maximumFractionDigits: 0,
    });
const compactFormat = new Intl.NumberFormat('nl-NL', {
    notation: 'compact',
    maximumFractionDigits: 0,
});

export function formatPct(ratio: Decimal | null): string | null {
    return ratio === null ? null : percentFormat.format(ratio.toNumber());
}

export function formatRatio(decimal: Decimal | null): string | null {
    return decimal === null ? null : ratioFormat.format(decimal.toNumber());
}

export function formatCap(decimal: Decimal | null, currency: string): string | null {
    if (decimal === null) {
        return null;
    }
    return currency === '' ? compactFormat.format(decimal.toNumber()) : capFormat(currency).format(decimal.toNumber());
}

interface MetricSource {
    readonly ratio: Decimal | null;
    readonly currency: string;
}

function formatByKind(row: MetricFormat, source: MetricSource): string | null {
    switch (row) {
        case 'pct':
            return formatPct(source.ratio);
        case 'ratio':
            return formatRatio(source.ratio);
        case 'ratio2':
            return source.ratio === null ? null : ratio2Format.format(source.ratio.toNumber());
        case 'cap':
            return formatCap(source.ratio, source.currency);
    }
}

/**
 * Builds the grouped compare table: one row per metric, one display value per column.
 * Columns without fundamentals get null values (“–” for every metric).
 */
export function buildCompareGroups(columns: readonly CompareColumn[]): CompareGroup[] {
    const metrics = columns.map((column): DerivedCompareMetrics | null =>
        column.fundamentals === null ? null : deriveCompareMetrics(column.fundamentals, column.price),
    );

    const valueOf = (
        index: number,
        pick: (fundamentals: FundamentalsResult) => string | null,
        derived: keyof DerivedCompareMetrics | null = null,
    ): MetricSource => {
        const column = columns[index];
        const currency = column?.currency ?? '';
        if (column?.fundamentals === undefined || column.fundamentals === null || metrics[index] === null) {
            return { ratio: null, currency };
        }
        const ratio = derived !== null ? metrics[index]![derived] : decimalOrNull(pick(column.fundamentals));
        return { ratio, currency };
    };

    const row = (
        key: string,
        label: string,
        format: MetricFormat,
        pick: (fundamentals: FundamentalsResult) => string | null,
        derived: keyof DerivedCompareMetrics | null = null,
        hint: string | null = null,
    ): CompareMetricRow => ({
        key,
        label,
        format,
        hint,
        values: columns.map((_, index) => formatByKind(format, valueOf(index, pick, derived))),
    });

    return [
        {
            key: 'valuation',
            label: 'Valuation',
            rows: [
                row('peTtm', 'P/E (TTM)', 'ratio', (f) => f.peTtm),
                row('forwardPe', 'Forward P/E', 'ratio', (f) => f.forwardPe, null, 'Price ÷ current-FY consensus EPS.'),
                row(
                    'nextYearForwardPe',
                    'Forward P/E (next FY)',
                    'ratio',
                    () => null,
                    'nextYearForwardPe',
                    'Price ÷ next-FY consensus EPS.',
                ),
                row(
                    'pegForward',
                    'PEG (fwd)',
                    'ratio2',
                    () => null,
                    'pegForward',
                    'P/E (TTM) ÷ expected next-FY EPS growth in %.',
                ),
                row('priceToSalesTtm', 'P/S (TTM)', 'ratio', (f) => f.priceToSalesTtm),
                row(
                    'forwardPriceToSales',
                    'Forward P/S',
                    'ratio',
                    () => null,
                    'forwardPriceToSales',
                    'Market cap ÷ next-FY consensus revenue.',
                ),
            ],
        },
        {
            key: 'growth',
            label: 'Growth',
            rows: [
                row('earningsGrowthTtm', 'EPS growth (TTM)', 'pct', (f) => f.earningsGrowthTtm),
                row('epsGrowthCurrentFy', 'EPS growth (current FY)', 'pct', (f) => f.estimates.epsGrowthCurrentFy),
                row('epsGrowthNextFy', 'EPS growth (next FY)', 'pct', (f) => f.estimates.epsGrowthNextFy),
                row(
                    'epsGrowthCurrentQtr',
                    'EPS growth (current qtr YoY)',
                    'pct',
                    (f) => f.estimates.epsGrowthCurrentQtr,
                ),
                row(
                    'ttmToNtmEpsGrowth',
                    'EPS growth (TTM → NTM)',
                    'pct',
                    () => null,
                    'ttmToNtmEpsGrowth',
                    'Implied growth from trailing EPS to next-FY consensus EPS.',
                ),
                row(
                    'twoYearEpsGrowthStack',
                    'EPS growth (2-yr stack)',
                    'pct',
                    () => null,
                    'twoYearEpsGrowthStack',
                    'Compounded current + next FY expected EPS growth.',
                ),
                row('revenueGrowthTtm', 'Revenue growth (TTM)', 'pct', (f) => f.revenueGrowthTtm),
                row('revGrowthCurrentFy', 'Revenue growth (current FY)', 'pct', (f) => f.estimates.revGrowthCurrentFy),
                row('revGrowthNextFy', 'Revenue growth (next FY)', 'pct', (f) => f.estimates.revGrowthNextFy),
                row(
                    'lastYearEarningsGrowth',
                    'Earnings growth (last FY)',
                    'pct',
                    () => null,
                    'lastYearEarningsGrowth',
                    'Last fiscal year net income growth vs the prior year.',
                ),
            ],
        },
        {
            key: 'margins',
            label: 'Margins & size',
            rows: [
                row('grossMargins', 'Gross margin', 'pct', (f) => f.grossMargins),
                row('marginTtm', 'Net margin', 'pct', (f) => f.marginTtm),
                row('marketCap', 'Market cap', 'cap', (f) => f.marketCap),
                row('revenueTtm', 'Revenue (TTM)', 'cap', (f) => f.revenueTtm),
            ],
        },
    ];
}
