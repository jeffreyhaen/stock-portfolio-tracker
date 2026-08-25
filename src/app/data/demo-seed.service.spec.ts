import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { vi } from 'vitest';
import { MINI_CSV } from '../../testing/seed';
import { PortfolioDatabase } from './db';
import { DemoSeedService } from './demo-seed.service';
import { PortfolioRepository } from './portfolio.repository';

const GITHUB_PAGES_DOCUMENT = {
    baseURI: 'https://jeffreyhaen.github.io/stock-portfolio-tracker/',
    location: {
        hostname: 'jeffreyhaen.github.io',
        pathname: '/stock-portfolio-tracker/',
    },
} as unknown as Document;
const LOCAL_DOCUMENT = {
    baseURI: 'http://localhost:4200/',
    location: {
        hostname: 'localhost',
        pathname: '/',
    },
} as unknown as Document;

describe('DemoSeedService', () => {
    let db: PortfolioDatabase;
    let service: DemoSeedService;

    beforeEach(async () => {
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                { provide: DOCUMENT, useValue: GITHUB_PAGES_DOCUMENT },
            ],
        }).compileComponents();
        service = TestBed.inject(DemoSeedService);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        db.close();
    });

    it('creates and imports the demo portfolio on an empty database', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MINI_CSV, { status: 200 }));

        await service.seed();

        const portfolios = await db.portfolios.toArray();
        expect(portfolios).toHaveLength(1);
        expect(portfolios[0].name).toBe('Demo');
        expect(await db.transactions.count()).toBe(4);
        expect(await db.importBatches.count()).toBe(1);
        expect(await db.settings.get('demoSeedVersion')).toEqual({ key: 'demoSeedVersion', value: '1' });
    });

    it('does not import the demo more than once', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MINI_CSV, { status: 200 }));

        await service.seed();
        await service.seed();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(await db.portfolios.count()).toBe(1);
        expect(await db.transactions.count()).toBe(4);
        expect(await db.importBatches.count()).toBe(1);
    });

    it('does not reseed after the demo portfolio is deleted', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MINI_CSV, { status: 200 }));
        const repository = TestBed.inject(PortfolioRepository);

        await service.seed();
        const demo = await db.portfolios.toArray();
        await repository.delete(demo[0].id);
        await service.seed();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(await db.portfolios.count()).toBe(0);
        expect(await db.settings.get('demoSeedVersion')).toEqual({ key: 'demoSeedVersion', value: '1' });
    });

    it('does not seed when the database already contains a portfolio', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        await db.portfolios.add({
            id: 'existing',
            name: 'Existing',
            reportingCurrency: 'EUR',
            createdAt: new Date().toISOString(),
        });

        await service.seed();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(await db.portfolios.count()).toBe(1);
        expect(await db.settings.get('demoSeedVersion')).toEqual({ key: 'demoSeedVersion', value: '1' });
    });

    it('does not seed on localhost', async () => {
        const localDb = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        try {
            TestBed.resetTestingModule();
            await TestBed.configureTestingModule({
                providers: [
                    { provide: PortfolioDatabase, useValue: localDb },
                    { provide: DOCUMENT, useValue: LOCAL_DOCUMENT },
                ],
            }).compileComponents();
            const localService = TestBed.inject(DemoSeedService);
            const fetchSpy = vi.spyOn(globalThis, 'fetch');

            await localService.seed();

            expect(fetchSpy).not.toHaveBeenCalled();
            expect(await localDb.portfolios.count()).toBe(0);
        } finally {
            localDb.close();
        }
    });
});
