import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { PortfolioDatabase } from '../../data/db';
import {
    DayBarDto,
    FundamentalsResult,
    MarketDataProvider,
    QuoteResult,
    TickerSuggestion,
} from '../../data/market-data-provider';
import { waitFor } from '../../../testing/seed';
import { ComparePage } from './compare-page';

const AMD_FUNDAMENTALS: FundamentalsResult = {
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

const AMD_BARS: DayBarDto[] = [
    { date: '2025-09-05', close: '100' },
    { date: '2025-12-01', close: '120' },
    { date: '2026-03-02', close: '150' },
];

interface StubConfig {
    readonly fundamentals: FundamentalsResult | null;
    readonly quote: QuoteResult | null;
    readonly bars: DayBarDto[];
}

class StubProvider extends MarketDataProvider {
    constructor(private readonly config: StubConfig) {
        super();
    }

    override async quote(): Promise<QuoteResult> {
        if (this.config.quote === null) {
            throw new Error('No quote');
        }
        return this.config.quote;
    }

    override async history(): Promise<{ currency: string; bars: DayBarDto[]; splits: [] }> {
        return { currency: 'USD', bars: this.config.bars, splits: [] };
    }

    override async search(): Promise<TickerSuggestion[]> {
        return [];
    }

    override async fundamentals(symbol: string): Promise<FundamentalsResult> {
        if (this.config.fundamentals === null) {
            throw new Error(`No fundamentals for ${symbol}`);
        }
        return { ...this.config.fundamentals, symbol: symbol.toUpperCase() };
    }
}

@Component({ selector: 'app-test-dummy-route', imports: [], template: '' })
class DummyRoute {}

describe('ComparePage', () => {
    let db: PortfolioDatabase;

    function configure(provider: MarketDataProvider | null): void {
        TestBed.resetTestingModule();
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        TestBed.configureTestingModule({
            imports: [ComparePage, DummyRoute],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                ...(provider === null ? [] : [{ provide: MarketDataProvider, useValue: provider }]),
            ],
        }).compileComponents();
    }

    async function createPage(): Promise<ComparePage> {
        const fixture = TestBed.createComponent(ComparePage);
        fixture.detectChanges();
        return fixture.componentInstance;
    }

    beforeEach(() => {
        configure(
            new StubProvider({
                fundamentals: AMD_FUNDAMENTALS,
                quote: { price: '477.57', currency: 'USD', date: '2026-09-04' },
                bars: AMD_BARS,
            }),
        );
    });

    it('starts empty', async () => {
        const page = await createPage();
        expect(page.entries()).toEqual([]);
        expect(page.groups().every((group) => group.rows.every((row) => row.values.length === 0))).toBe(true);
    });

    it('loads fundamentals, quote and history for a symbol', async () => {
        const page = await createPage();
        page.addSymbol({ symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', exchange: 'NASDAQ' });
        await waitFor(() => page.entries()[0]?.loading === false);

        const entry = page.entries()[0];
        expect(entry.error).toBeNull();
        expect(entry.fundamentals?.peTtm).toBe('116.2');
        expect(entry.price).toBe('477.57');
        expect(entry.currency).toBe('USD');
        expect(entry.bars).toEqual(AMD_BARS);

        const peRow = page.groups()[0].rows.find((row) => row.key === 'peTtm')!;
        expect(peRow.values[0]).toBe('116,2');
        expect(page.chartSeries()).toHaveLength(1);
        expect(page.chartSeries()[0].points.map((point) => point.value)).toEqual([100, 120, 150]);
    });

    it('rejects duplicates and caps the number of symbols', async () => {
        const page = await createPage();
        page.addSymbol({ symbol: 'AMD', name: 'AMD', exchange: '' });
        await waitFor(() => page.entries()[0]?.loading === false);

        page.addSymbol({ symbol: 'amd', name: 'AMD', exchange: '' });
        expect(page.notice()).toBe('AMD is already in the comparison.');
        expect(page.entries()).toHaveLength(1);

        for (const symbol of ['MSFT', 'ASML', 'NFLX', 'KO', 'TSLA']) {
            page.addSymbol({ symbol, name: symbol, exchange: '' });
        }
        expect(page.entries()).toHaveLength(6);
        expect(page.canAdd()).toBe(false);

        page.addSymbol({ symbol: 'SHOP', name: 'SHOP', exchange: '' });
        expect(page.notice()).toBe('A comparison holds at most 6 symbols.');
        expect(page.entries()).toHaveLength(6);
    });

    it('removes a symbol', async () => {
        const page = await createPage();
        page.addSymbol({ symbol: 'AMD', name: 'AMD', exchange: '' });
        await waitFor(() => page.entries()[0]?.loading === false);
        page.removeSymbol(page.entries()[0].id);
        expect(page.entries()).toEqual([]);
        expect(page.canAdd()).toBe(true);
    });

    it('keeps the column when fundamentals fail and shows the error', async () => {
        configure(
            new StubProvider({
                fundamentals: null,
                quote: { price: '477.57', currency: 'USD', date: '2026-09-04' },
                bars: [],
            }),
        );
        const page = await createPage();
        page.addSymbol({ symbol: 'AMD', name: 'AMD', exchange: '' });
        await waitFor(() => page.entries()[0]?.loading === false);

        const entry = page.entries()[0];
        expect(entry.error).toBe('No fundamentals for AMD');
        expect(entry.fundamentals).toBeNull();
        const peRow = page.groups()[0].rows.find((row) => row.key === 'peTtm')!;
        expect(peRow.values).toEqual([null]);
    });

    it('degrades gracefully when history is unavailable', async () => {
        configure(
            new StubProvider({
                fundamentals: AMD_FUNDAMENTALS,
                quote: { price: '477.57', currency: 'USD', date: '2026-09-04' },
                bars: [],
            }),
        );
        const page = await createPage();
        page.addSymbol({ symbol: 'AMD', name: 'AMD', exchange: '' });
        await waitFor(() => page.entries()[0]?.loading === false);

        expect(page.entries()[0].historyError).toBeNull();
        expect(page.entries()[0].price).toBe('477.57');
        expect(page.chartSeries()).toEqual([]);
    });

    it('reports that market data is unavailable without a provider', async () => {
        configure(null);
        const page = await createPage();
        page.addSymbol({ symbol: 'AMD', name: 'AMD', exchange: '' });
        await waitFor(() => page.entries()[0]?.loading === false);

        expect(page.entries()[0].error).toBe('Market data is not available on this origin.');
    });
});
