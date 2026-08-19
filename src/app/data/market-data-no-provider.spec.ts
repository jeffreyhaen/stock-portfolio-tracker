import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from './db';
import { MarketDataService } from './market-data.service';
import { MarketDataSyncService } from './market-data-sync.service';

describe('market data without a provider', () => {
    it('keeps cached data available when an optional refresh cannot run', async () => {
        const db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        await db.securities.put({
            isin: 'ISIN',
            name: 'Cached security',
            tradingCurrency: 'EUR',
            exchange: null,
            quoteTicker: 'CACHED',
        });
        await db.quoteCache.put({
            key: 'ISIN',
            price: '42',
            currency: 'EUR',
            timestamp: new Date().toISOString(),
            source: 'yahoo',
        });
        TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db }] });
        const marketData = TestBed.inject(MarketDataService);
        await marketData.ready;

        const report = await TestBed.inject(MarketDataSyncService).refreshAll('2020-01-01');

        expect(report.serviceUnavailable).toBe(true);
        expect(marketData.offline()).toBe(true);
        expect(marketData.quoteMap().get('ISIN')?.price.toFixed()).toBe('42');
        db.close();
    });
});
