import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from './db';
import { MarketDataService } from './market-data.service';

describe('MarketDataService', () => {
    let db: PortfolioDatabase;

    beforeEach(() => {
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db }] });
    });

    afterEach(() => db.close());

    it('keeps Yahoo provenance as market data after persistence', async () => {
        await db.quoteCache.put({
            key: 'ISIN',
            price: '42',
            currency: 'EUR',
            timestamp: new Date().toISOString(),
            source: 'yahoo',
        });
        const service = TestBed.inject(MarketDataService);
        await service.ready;

        expect(service.quoteMap().get('ISIN')?.source).toBe('market');
        expect(service.quoteMap().get('ISIN')?.stale).toBe(false);
    });

    it('exposes cache readiness and coalesces concurrent reloads', async () => {
        await db.quoteCache.put({
            key: 'ISIN',
            price: '42',
            currency: 'EUR',
            timestamp: new Date().toISOString(),
            source: 'manual',
        });
        const service = TestBed.inject(MarketDataService);

        expect(service.cacheReady()).toBe(false);
        expect(service.reload()).toBe(service.ready);
        await service.ready;

        expect(service.cacheReady()).toBe(true);
        expect(service.quotes().map((quote) => quote.key)).toEqual(['ISIN']);
        expect(service.quoteMap().get('ISIN')?.source).toBe('manual');
    });
});
