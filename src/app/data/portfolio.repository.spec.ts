import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { MINI_CSV } from '../../testing/seed';
import { PortfolioDatabase } from './db';
import { ImportService } from './import.service';
import { PortfolioRepository } from './portfolio.repository';

describe('PortfolioRepository', () => {
    let db: PortfolioDatabase;
    let repository: PortfolioRepository;
    let importService: ImportService;

    beforeEach(async () => {
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        await TestBed.configureTestingModule({
            providers: [{ provide: PortfolioDatabase, useValue: db }],
        });
        repository = TestBed.inject(PortfolioRepository);
        importService = TestBed.inject(ImportService);
        await db.portfolios.add({
            id: 'p1',
            name: 'First',
            reportingCurrency: 'EUR',
            lotStrategy: 'fifo',
            createdAt: new Date().toISOString(),
        });
        await db.portfolios.add({
            id: 'p2',
            name: 'Tweede',
            reportingCurrency: 'EUR',
            lotStrategy: 'fifo',
            createdAt: new Date().toISOString(),
        });
    });

    it('creates portfolios with LIFO lot consumption', async () => {
        const portfolio = await repository.create('Created', 'USD');

        expect(portfolio.lotStrategy).toBe('lifo');
        expect((await db.portfolios.get(portfolio.id))?.lotStrategy).toBe('lifo');
    });

    it('renames only the selected portfolio', async () => {
        await repository.rename('p1', 'Renamed');

        expect((await db.portfolios.get('p1'))?.name).toBe('Renamed');
        expect((await db.portfolios.get('p2'))?.name).toBe('Tweede');
    });

    it('updates the lot strategy and rejects an unknown portfolio', async () => {
        await repository.updateLotStrategy('p1', 'lifo');

        expect((await db.portfolios.get('p1'))?.lotStrategy).toBe('lifo');
        expect((await db.portfolios.get('p2'))?.lotStrategy).toBe('fifo');
        await expect(repository.updateLotStrategy('missing', 'fifo')).rejects.toThrow('Portfolio not found.');
    });

    it('deletes portfolio, transactions and import batches only for that portfolio', async () => {
        await importService.importCsv('p1', 'mini.csv', MINI_CSV);
        await importService.importCsv('p2', 'mini.csv', MINI_CSV);
        expect(await db.transactions.count()).toBe(8);

        await repository.delete('p1');

        expect(await db.portfolios.get('p1')).toBeUndefined();
        expect(await db.portfolios.get('p2')).not.toBeUndefined();
        const resterend = await db.transactions.toArray();
        expect(resterend).toHaveLength(4);
        expect(resterend.every((txn) => txn.portfolioId === 'p2')).toBe(true);
        expect(await db.importBatches.where('portfolioId').equals('p1').count()).toBe(0);
        expect(await db.importBatches.where('portfolioId').equals('p2').count()).toBe(1);
    });
});
