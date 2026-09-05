import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { FundamentalsResult } from '../data/market-data-provider';
import { buildCompareGroups, CompareColumn, deriveCompareMetrics, formatCap } from './compare';

const AMD: FundamentalsResult = {
    symbol: 'AMD',
    currency: 'USD',
    longName: 'Advanced Micro Devices, Inc.',
    sharesOutstanding: '1632475042',
    epsTtm: '4.11',
    peTtm: '116.2',
    marketCap: '779621105664',
    revenueTtm: '41305001984',
    revenueGrowthTtm: '0.21',
    earningsGrowthTtm: '0.35',
    marginTtm: '0.15577',
    grossMargins: '0.49',
    forwardPe: '40.2',
    priceToSalesTtm: '8.9',
    fiscalYearEnd: '2025-12-31',
    revenueFy: '34639000000',
    netIncomeFy: '4335000000',
    netIncomeFyPrev: '3100000000',
    estimates: {
        epsGrowthCurrentQtr: '0.4',
        epsGrowthCurrentFy: '0.45',
        epsGrowthNextFy: '0.25',
        revGrowthCurrentFy: '0.18',
        revGrowthNextFy: '0.12',
        epsEstimateCurrentFy: '5.96',
        epsEstimateNextFy: '7.45',
        revenueEstimateNextFy: '52600000000',
    },
};

const column = (overrides: Partial<CompareColumn> = {}): CompareColumn => ({
    symbol: 'AMD',
    longName: AMD.longName,
    currency: 'USD',
    price: '477.57',
    fundamentals: AMD,
    ...overrides,
});

function expectDecimalClose(actual: Decimal, expected: string, tolerance: string): void {
    expect(actual.minus(new Decimal(expected)).abs().lte(new Decimal(tolerance))).toBe(true);
}

describe('deriveCompareMetrics', () => {
    it('derives all advanced metrics from fundamentals and price', () => {
        const derived = deriveCompareMetrics(AMD, '477.57');

        expectDecimalClose(derived.lastYearEarningsGrowth!, '0.398387096774', '0.000000000001');
        expectDecimalClose(derived.ttmToNtmEpsGrowth!, '0.812652068127', '0.000000000001');
        expectDecimalClose(derived.twoYearEpsGrowthStack!, '0.8125', '0.000000000001');
        expectDecimalClose(derived.nextYearForwardPe!, '64.103355704697986577', '0.000000000001');
        expectDecimalClose(derived.pegForward!, '4.648', '0.000000000001');
        expectDecimalClose(derived.forwardPriceToSales!, '14.821694024030418251', '0.000000000001');
    });

    it('returns null for metrics that cannot be computed', () => {
        const sparse: FundamentalsResult = {
            ...AMD,
            epsTtm: null,
            peTtm: null,
            marketCap: null,
            netIncomeFy: null,
            netIncomeFyPrev: null,
            estimates: {
                epsGrowthCurrentQtr: null,
                epsGrowthCurrentFy: null,
                epsGrowthNextFy: null,
                revGrowthCurrentFy: null,
                revGrowthNextFy: null,
                epsEstimateCurrentFy: null,
                epsEstimateNextFy: null,
                revenueEstimateNextFy: null,
            },
        };
        const derived = deriveCompareMetrics(sparse, '100');

        expect(derived.lastYearEarningsGrowth).toBeNull();
        expect(derived.ttmToNtmEpsGrowth).toBeNull();
        expect(derived.twoYearEpsGrowthStack).toBeNull();
        expect(derived.nextYearForwardPe).toBeNull();
        expect(derived.pegForward).toBeNull();
        expect(derived.forwardPriceToSales).toBeNull();
    });

    it('rejects non-positive inputs for ratio metrics', () => {
        const derived = deriveCompareMetrics(
            {
                ...AMD,
                peTtm: '-5',
                epsTtm: '-2',
                marketCap: '1000',
                estimates: { ...AMD.estimates, epsGrowthNextFy: '-0.1', epsEstimateNextFy: '-1' },
            },
            '477.57',
        );

        expect(derived.pegForward).toBeNull();
        expect(derived.ttmToNtmEpsGrowth).toBeNull();
        expect(derived.nextYearForwardPe).toBeNull();
        expectDecimalClose(derived.forwardPriceToSales!, '1.9011406844106463878e-8', '1e-20');
    });

    it('handles a negative prior-year net income with the |denominator| convention', () => {
        const derived = deriveCompareMetrics({ ...AMD, netIncomeFyPrev: '-1000000000' }, '477.57');
        expectDecimalClose(derived.lastYearEarningsGrowth!, '5.335', '0.0000001');
    });
});

describe('buildCompareGroups', () => {
    it('builds one display value per column and marks unavailable metrics as null', () => {
        const groups = buildCompareGroups([column(), column({ symbol: 'MISSING', fundamentals: null, price: null })]);

        expect(groups.map((group) => group.label)).toEqual(['Valuation', 'Growth', 'Margins & size']);
        const peTtm = groups[0].rows.find((r) => r.key === 'peTtm')!;
        expect(peTtm.values).toEqual(['116,2', null]);

        const twoYearStack = groups[1].rows.find((r) => r.key === 'twoYearEpsGrowthStack')!;
        expect(twoYearStack.values).toEqual(['81,3%', null]);

        const marketCap = groups[2].rows.find((r) => r.key === 'marketCap')!;
        expect(marketCap.values).toEqual(['$\u00A0780\u00A0mld.', null]);
    });

    it('formats percentages, ratios and caps with nl-NL conventions', () => {
        const groups = buildCompareGroups([column()]);
        const all = new Map(groups.flatMap((group) => group.rows).map((r) => [r.key, r.values[0]]));

        expect(all.get('grossMargins')).toBe('49%');
        expect(all.get('marginTtm')).toBe('15,6%');
        expect(all.get('earningsGrowthTtm')).toBe('35%');
        expect(all.get('peTtm')).toBe('116,2');
        expect(all.get('priceToSalesTtm')).toBe('8,9');
        expect(all.get('pegForward')).toBe('4,65');
        expect(all.get('revenueTtm')).toBe('$\u00A041\u00A0mld.');
    });

    it('falls back to a plain compact number when the currency is unknown', () => {
        expect(formatCap(new Decimal(780000000000), '')).toBe('780\u00A0mld.');
        expect(formatCap(null, 'USD')).toBeNull();
    });
});
