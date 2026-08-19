import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { signal, WritableSignal } from '@angular/core';
import { PortfolioDatabase } from './db';
import { FxService } from './fx.service';
import { MarketDataService } from './market-data.service';
import { MarketDataProvider, TickerSuggestion } from './market-data-provider';
import { MarketDataSyncService } from './market-data-sync.service';

describe('MarketDataSyncService auto-link', () => {
    let db: PortfolioDatabase;
    let service: MarketDataSyncService;
    let offline: WritableSignal<boolean>;
    let refreshing: WritableSignal<boolean>;
    let lastRefresh: WritableSignal<string | null>;
    let search: (query: string) => Promise<TickerSuggestion[]>;
    let quotes: (symbols: readonly string[]) => Promise<Record<string, never>>;

    beforeEach(() => {
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        offline = signal(false);
        refreshing = signal(false);
        lastRefresh = signal(null);
        search = async () => [];
        quotes = async () => ({});
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                MarketDataSyncService,
                { provide: PortfolioDatabase, useValue: db },
                {
                    provide: MarketDataProvider,
                    useValue: {
                        search: (query: string) => search(query),
                        quotes: (symbols: readonly string[]) => quotes(symbols),
                    },
                },
                { provide: FxService, useValue: {} },
                {
                    provide: MarketDataService,
                    useValue: {
                        offline,
                        refreshing,
                        lastRefresh,
                        reportingCurrency: () => 'EUR',
                        reload: async () => undefined,
                    },
                },
            ],
        });
        service = TestBed.inject(MarketDataSyncService);
    });

    afterEach(() => {
        db.close();
    });

    it('skips the automatic refresh when today was already refreshed', async () => {
        await db.settings.put({ key: 'lastQuoteRefreshDay', value: localToday() });
        let contacted = false;
        quotes = async () => {
            contacted = true;
            return {};
        };

        const report = await service.refreshAllIfNeeded('2020-01-01');

        expect(report).toBeNull();
        expect(contacted).toBe(false);
    });

    it('reports the market data service as unavailable when a search fails', async () => {
        await db.securities.add({
            isin: 'US0000000001',
            name: 'Example',
            tradingCurrency: null,
            exchange: null,
            quoteTicker: null,
        });
        search = async () => {
            throw new Error('Failed to fetch');
        };

        const report = await service.autoLink('2020-01-01', ['US0000000001']);

        expect(report.serviceUnavailable).toBe(true);
        expect(report.linked).toEqual([]);
        expect(report.noCandidate).toEqual([]);
        expect(offline()).toBe(false);
    });

    it('reports no linked tickers without contacting the market data service', async () => {
        const report = await service.refreshAll('2020-01-01');

        expect(report.serviceUnavailable).toBe(false);
        expect(report.quotesRequested).toBe(0);
        expect(report.quotesUpdated).toBe(0);
        expect(offline()).toBe(false);
        expect(refreshing()).toBe(false);
    });

    it('reports the market data service as unavailable when a refresh fails', async () => {
        await db.securities.add({
            isin: 'US0000000003',
            name: 'Example',
            tradingCurrency: null,
            exchange: null,
            quoteTicker: 'EXAMPLE',
        });
        quotes = async () => {
            throw new Error('Failed to fetch');
        };

        const report = await service.refreshAll('2020-01-01');

        expect(report.serviceUnavailable).toBe(true);
        expect(report.quotesRequested).toBe(1);
        expect(report.quotesUpdated).toBe(0);
        expect(offline()).toBe(true);
        expect(refreshing()).toBe(false);
    });

    it('records a successful refresh day', async () => {
        const report = await service.refreshAll('2020-01-01');

        expect(report.serviceUnavailable).toBe(false);
        expect((await db.settings.get('lastQuoteRefreshDay'))?.value).toBe(localToday());
    });

    it('does not overwrite a manual link while an automatic search is pending', async () => {
        await db.securities.add({
            isin: 'US0000000004',
            name: 'Example',
            tradingCurrency: null,
            exchange: null,
            quoteTicker: null,
        });
        let resolveSearch!: (suggestions: TickerSuggestion[]) => void;
        search = () => new Promise((resolve) => (resolveSearch = resolve));

        const autoLink = service.autoLink('2020-01-01', ['US0000000004']);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await service.linkTicker('US0000000004', 'MANUAL');
        resolveSearch([{ symbol: 'AUTO', name: 'Example', exchange: 'NYSE' }]);
        const report = await autoLink;

        expect(report.linked).toEqual([]);
        expect((await db.securities.get('US0000000004'))?.quoteTicker).toBe('MANUAL');
    });

    it('keeps an empty search result as a no-match', async () => {
        await db.securities.add({
            isin: 'US0000000002',
            name: 'Example',
            tradingCurrency: null,
            exchange: null,
            quoteTicker: null,
        });

        const report = await service.autoLink('2020-01-01', ['US0000000002']);

        expect(report.serviceUnavailable).toBe(false);
        expect(report.linked).toEqual([]);
        expect(report.noCandidate).toEqual(['US0000000002']);
        expect(offline()).toBe(false);
    });
});

function localToday(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
