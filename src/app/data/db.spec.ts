import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from './db';

describe('PortfolioDatabase migrations', () => {
    it('migrates legacy Dutch fields and primary keys to English fields', async () => {
        const indexedDB = new IDBFactory();
        const options = { indexedDB, IDBKeyRange };
        const legacy = new Dexie('stock-portfolio', options);
        legacy.version(1).stores({
            portfolios: 'id',
            importBatches: 'id, portfolioId',
            transactions: '++id, [portfolioId+datum], fingerprint',
            securities: 'isin',
            securityAliases: 'oudIsin, nieuwIsin',
            quoteCache: 'sleutel',
            fxCache: '[paar+datum]',
            settings: 'sleutel',
        });
        legacy.version(2).stores({ priceHistory: '[isin+datum], isin' });
        legacy.version(3).stores({ splitEvents: '[isin+datum]' });
        await legacy.open();
        await legacy
            .table('portfolios')
            .put({ id: 'pf-1', naam: 'Legacy', rapportagevaluta: 'EUR', aangemaaktOp: '2026-01-01' });
        await legacy
            .table('securityAliases')
            .put({ oudIsin: 'OLD', nieuwIsin: 'NEW', datum: '2026-01-02', reden: 'split' });
        await legacy
            .table('quoteCache')
            .put({ sleutel: 'OLD', prijs: '10', valuta: 'EUR', tijdstip: '2026-01-02', bron: 'manual' });
        await legacy.table('settings').put({ sleutel: 'selectedPortfolio', waarde: 'pf-1' });
        legacy.close();

        const migrated = new PortfolioDatabase(options);
        await migrated.open();
        const portfolio = await migrated.portfolios.get('pf-1');
        const alias = await migrated.securityAliases.get('OLD');
        const quote = await migrated.quoteCache.get('OLD');
        const setting = await migrated.settings.get('selectedPortfolio');

        expect(portfolio?.name).toBe('Legacy');
        expect(portfolio?.reportingCurrency).toBe('EUR');
        expect(portfolio?.lotStrategy).toBe('fifo');
        expect(alias).toEqual({ oldIsin: 'OLD', newIsin: 'NEW', date: '2026-01-02', reason: 'split' });
        expect(quote).toEqual({ key: 'OLD', price: '10', currency: 'EUR', timestamp: '2026-01-02', source: 'manual' });
        expect(setting).toEqual({ key: 'selectedPortfolio', value: 'pf-1' });
        migrated.close();
    });

    it('adds FIFO lot consumption to portfolios upgraded from version 7', async () => {
        const indexedDB = new IDBFactory();
        const options = { indexedDB, IDBKeyRange };
        const version7 = new Dexie('stock-portfolio', options);
        version7.version(7).stores({
            portfolios: 'id',
            importBatches: 'id, portfolioId',
            transactions: '++id, [portfolioId+date], fingerprint',
            securities: 'isin',
            securityAliases: 'oldIsin, newIsin',
            quoteCache: 'key',
            fxCache: '[pair+date]',
            priceHistory: '[isin+date], isin',
            splitEvents: '[isin+date]',
            settings: 'key',
        });
        await version7.open();
        await version7.table('portfolios').put({
            id: 'pf-1',
            name: 'Existing',
            reportingCurrency: 'EUR',
            createdAt: '2026-01-01',
        });
        version7.close();

        const migrated = new PortfolioDatabase(options);
        await migrated.open();

        expect((await migrated.portfolios.get('pf-1'))?.lotStrategy).toBe('fifo');
        migrated.close();
    });
});
