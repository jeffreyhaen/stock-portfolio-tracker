import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { PortfolioDatabase } from '../../data/db';
import { FundamentalsResult, MarketDataProvider, QuoteResult, TickerSuggestion } from '../../data/market-data-provider';
import { ProjectionService } from '../../data/projection.service';
import { ProjectionPage } from './projection-page';

const AMD_FUNDAMENTALS: FundamentalsResult = {
    symbol: 'AMD',
    currency: 'USD',
    longName: 'Advanced Micro Devices, Inc.',
    sharesOutstanding: '1632475000',
    epsTtm: '4.11',
    peTtm: '116.2',
    marketCap: '779621105664',
    revenueTtm: '41305001984',
    revenueGrowthTtm: '0.21',
    marginTtm: '0.15577',
    fiscalYearEnd: '2025-12-31',
    revenueFy: '46979000000',
    netIncomeFy: '11005499037',
};

const AMD_QUOTE: QuoteResult = { price: '477.57', currency: 'USD', date: '2026-09-04' };

class StubProvider extends MarketDataProvider {
    constructor(
        private readonly fundamentalsResult: FundamentalsResult | null,
        private readonly quoteResult: QuoteResult | null,
    ) {
        super();
    }

    override async quote(): Promise<QuoteResult> {
        if (this.quoteResult === null) {
            throw new Error('No quote');
        }
        return this.quoteResult;
    }

    override async history() {
        return { currency: 'USD', bars: [], splits: [] };
    }

    override async search(): Promise<TickerSuggestion[]> {
        return [];
    }

    override async fundamentals(symbol: string): Promise<FundamentalsResult> {
        if (this.fundamentalsResult === null) {
            throw new Error(`No fundamentals for ${symbol}`);
        }
        return this.fundamentalsResult;
    }
}

describe('ProjectionPage', () => {
    let db: PortfolioDatabase;

    function configure(provider: MarketDataProvider | null): void {
        TestBed.resetTestingModule();
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        TestBed.configureTestingModule({
            imports: [ProjectionPage],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                ...(provider === null ? [] : [{ provide: MarketDataProvider, useValue: provider }]),
                provideRouter([]),
            ],
        }).compileComponents();
    }

    async function createPage(): Promise<ProjectionPage> {
        const fixture = TestBed.createComponent(ProjectionPage);
        fixture.detectChanges();
        return fixture.componentInstance;
    }

    beforeEach(() => {
        configure(new StubProvider(AMD_FUNDAMENTALS, AMD_QUOTE));
    });

    it('starts with an empty state before a symbol is picked', async () => {
        const page = await createPage();
        expect(page.symbol()).toBeNull();
        expect(page.drafts()).toBeNull();
        expect(page.modelError()).toBe('Pick a symbol to start a projection.');
    });

    it('prefills a default model from fundamentals and quote', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(page.symbol()).toBe('AMD');
        expect(page.fundamentals()?.currency).toBe('USD');
        expect(page.quote()?.price).toBe('477.57');
        const drafts = page.drafts();
        expect(drafts).not.toBeNull();
        expect(drafts!.baseYear).toBe('2025');
        expect(drafts!.baseRevenue).toBe('46979000000');
        expect(drafts!.baseNetIncome).toBe('11005499037');
        expect(drafts!.projectedYears).toBe('4');
        expect(drafts!.scenarios[0].name).toBe('Base');
        expect(drafts!.scenarios[0].growth[1]).toBe('21.0');
        expect(drafts!.scenarios[0].margin[1]).toBe('15.6');
        expect(drafts!.scenarios[0].peLow[1]).toBe('116.2');
        expect(drafts!.scenarios[0].peHigh[1]).toBe('116.2');
        expect(page.modelError()).toBeNull();
    });

    it('reproduces the AMD sheet scenario through the page', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const drafts = page.drafts()!;
        page.drafts.set({
            ...drafts,
            scenarios: [
                {
                    name: 'Base',
                    growth: ['', '35', '35', '35', '35'],
                    margin: ['', '35', '35', '35', '35'],
                    peLow: ['30', '30', '30', '30', '30'],
                    peHigh: ['50', '50', '50', '50', '50'],
                },
            ],
        });

        const results = page.activeResults();
        expect(results).not.toBeNull();
        expect(results!).toHaveLength(5);
        expect(results![0].priceLow.toFixed(6)).toBe('202.248102');
        expect(results![4].priceLow.toFixed(3)).toBe('1003.648');
        expect(results![4].priceHigh.toFixed(3)).toBe('1672.747');
        expect(results![3].cagrLowPct!.toFixed(3)).toBe('15.896');
        expect(results![4].cagrLowPct!.toFixed(3)).toBe('20.403');
        expect(results![1].cagrLowPct).toBeNull();
        expect(page.chartSeries().map((s) => s.name)).toEqual(['Low case', 'High case']);
    });

    it('adds and removes scenarios with unique names', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        page.openScenarioEditor();
        expect(page.newScenarioName()).toBe('Base 2');
        page.newScenarioName.set('Bear');
        page.confirmAddScenario();

        expect(page.scenarioNames()).toEqual(['Base', 'Bear']);
        expect(page.activeScenario()).toBe(1);
        expect(page.drafts()!.scenarios[1].name).toBe('Bear');
        expect(page.drafts()!.scenarios[1].peLow).toEqual(page.drafts()!.scenarios[0].peLow);

        page.openScenarioEditor();
        page.newScenarioName.set('Bear');
        page.confirmAddScenario();
        expect(page.scenarioNames()).toEqual(['Base', 'Bear']);

        page.removeScenario(1);
        expect(page.scenarioNames()).toEqual(['Base']);
        expect(page.activeScenario()).toBe(0);
    });

    it('resizes the horizon while keeping scenario values', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        page.setProjectedYears('3');
        const scenario = page.drafts()!.scenarios[0];
        expect(page.drafts()!.projectedYears).toBe('3');
        expect(scenario.growth).toHaveLength(4);
        expect(scenario.peHigh).toHaveLength(4);

        page.setProjectedYears('7');
        const grown = page.drafts()!.scenarios[0];
        expect(grown.growth).toHaveLength(8);
        expect(grown.growth[7]).toBe(scenario.growth[3]);
        expect(grown.peHigh[7]).toBe(scenario.peHigh[3]);
        expect(grown.growth[0]).toBe('');
    });

    it('persists the model and reloads it for the same symbol', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        page.setProjectedYears('4');

        const service = TestBed.inject(ProjectionService);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const stored = await db.projectionModels.get('AMD');
        expect(stored?.projectedYears).toBe(4);

        const reloaded = await service.loadModel('AMD');
        expect(reloaded?.projectedYears).toBe(4);
        expect(reloaded?.scenarios[0].name).toBe('Base');
        expect(reloaded?.baseRevenue.toFixed()).toBe('46979000000');
    });

    it('falls back to manual mode when fundamentals are unavailable', async () => {
        configure(null);
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(page.fundamentals()).toBeNull();
        expect(page.offline()).toBe(true);
        expect(page.projectionService.fundamentalsError()).toContain('Market data is not available');
        expect(page.drafts()!.baseRevenue).toBe('');
        expect(page.modelError()).not.toBeNull();

        page.drafts.set({
            baseYear: '2025',
            baseRevenue: '46979000000',
            baseNetIncome: '11005499037',
            currentPrice: '477.57',
            sharesOutstanding: '1632475000',
            currency: ' usd ',
            projectedYears: '1',
            scenarios: [
                {
                    name: 'Base',
                    growth: ['', '10'],
                    margin: ['', '20'],
                    peLow: ['30', '30'],
                    peHigh: ['50', '50'],
                },
            ],
        });
        expect(page.modelError()).toBeNull();
        expect(page.currency()).toBe('USD');
        expect(page.parsedModel()?.currency).toBe('USD');
        const results = page.activeResults();
        expect(results![1].revenue.toFixed(2)).toBe('51676900000.00');
        expect(results![1].priceHigh.toFixed(2)).toBe('316.56');
    });

    it('keeps the manual currency when persisting and reloading the model', async () => {
        configure(null);
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        page.setDraft('currency', 'USD');
        page.setDraft('baseRevenue', '46979000000');
        page.setDraft('baseNetIncome', '11005499037');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const stored = await db.projectionModels.get('AMD');
        expect(stored?.currency).toBe('USD');

        const reloaded = await TestBed.inject(ProjectionService).loadModel('AMD');
        expect(reloaded?.currency).toBe('USD');
    });

    it('warns about negative base earnings', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        page.setDraft('baseNetIncome', '-1000000');
        expect(page.negativeEarnings()).toBe(true);
    });

    it('saves, lists, views and deletes snapshots', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const drafts = page.drafts()!;
        page.drafts.set({
            ...drafts,
            currentPrice: '477.57',
            sharesOutstanding: '1632475000',
            scenarios: [
                {
                    name: 'Base',
                    growth: ['', '35', '35', '35', '35'],
                    margin: ['', '35', '35', '35', '35'],
                    peLow: ['30', '30', '30', '30', '30'],
                    peHigh: ['50', '50', '50', '50', '50'],
                },
            ],
        });
        await page.saveSnapshot();

        expect(page.snapshots()).toHaveLength(1);
        const snapshot = page.snapshots()[0];
        expect(snapshot.symbol).toBe('AMD');
        expect(snapshot.currency).toBe('USD');
        expect(page.snapshotEndPrice(snapshot, 'low')!.toFixed(3)).toBe('1003.648');
        expect(page.snapshotEndPrice(snapshot, 'high')!.toFixed(3)).toBe('1672.747');

        page.viewSnapshot(snapshot);
        expect(page.viewingSnapshot()).not.toBeNull();
        expect(page.activeResults()!.at(-1)!.priceLow.toFixed(3)).toBe('1003.648');
        page.backToCurrent();
        expect(page.viewingSnapshot()).toBeNull();

        await page.deleteSnapshot(snapshot);
        expect(page.snapshots()).toHaveLength(0);
    });

    it('applies the first projected value to all later columns', async () => {
        const page = await createPage();
        await page.pickSymbol({ symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const drafts = page.drafts()!;
        page.drafts.set({
            ...drafts,
            scenarios: [
                {
                    ...drafts.scenarios[0],
                    growth: ['', '7', '', '', '', ''],
                    margin: ['', '40', '', '', '', ''],
                },
            ],
        });
        page.applyGrowthToAll(0);
        page.applyMarginToAll(0);
        const scenario = page.drafts()!.scenarios[0];
        expect(scenario.growth).toEqual(['', '7', '7', '7', '7', '7']);
        expect(scenario.margin).toEqual(['', '40', '40', '40', '40', '40']);
    });
});
