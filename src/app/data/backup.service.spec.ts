import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { positionsAt } from '../domain/engine';
import { BackupService, CURRENT_SCHEMA_VERSION, parseBundle, validateBundle } from './backup.service';
import { PortfolioDatabase } from './db';
import { ImportService } from './import.service';
import { fromStored } from './mappers';
import { BackupError } from './stored-types';
import { TransactionRepository } from './transaction.repository';

const HEADER = 'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id';

const MINI_CSV = [
    HEADER,
    '01-01-2021,10:00,01-01-2021,,,iDEAL Deposit,,EUR,"50000,00",EUR,"50000,00",',
    '12-02-2026,10:00,12-02-2026,AMD,US0079031078,"Koop 12 @ 100,00 USD",,USD,"-1200,00",USD,"-1200,00",aaaaaaaa-1111-1111-1111-111111111111',
    '14-02-2026,10:00,14-02-2026,ASML,USN070592100,"Koop 3 @ 500,00 EUR",,EUR,"-1500,00",EUR,"48500,00",cccccccc-1111-1111-1111-111111111333',
].join('\n');

function createDb(): PortfolioDatabase {
    return new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
}

function seedDb(db: PortfolioDatabase): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db }] });
    return TestBed.inject(ImportService)
        .importCsv('pf-1', 'mini.csv', MINI_CSV)
        .then(() => undefined);
}

describe('BackupService', () => {
    let db: PortfolioDatabase;
    let service: BackupService;

    beforeEach(async () => {
        db = createDb();
        await seedDb(db);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db }] });
        service = TestBed.inject(BackupService);
    });

    afterEach(() => {
        db.close();
    });

    it('exports an empty database as a valid bundle', async () => {
        const emptyDb = createDb();
        try {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: emptyDb }] });
            const emptyService = TestBed.inject(BackupService);
            const bundle = await emptyService.export();
            expect(bundle.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
            expect(bundle.totals.transactions).toBe(0);
            expect(bundle.totals.portfolios).toBe(0);
            expect(bundle.data.transactions).toEqual([]);
            expect(bundle.data.portfolios).toEqual([]);
            expect(typeof bundle.exportedAt).toBe('string');
            expect(() => new Date(bundle.exportedAt).toISOString()).not.toThrow();
        } finally {
            emptyDb.close();
        }
    });

    it('exports all stores with identical data', async () => {
        await db.quoteCache.put({
            key: 'US0079031078',
            price: '120',
            currency: 'USD',
            timestamp: '2026-02-12T10:00:00Z',
            source: 'yahoo',
        });
        await db.priceHistory.put({ isin: 'US0079031078', date: '2026-02-12', close: '120', currency: 'USD' });
        await db.settings.put({ key: 'selectedPortfolio', value: 'pf-1' });

        const bundle = await service.export();
        expect(bundle.totals.transactions).toBe(3);
        expect(bundle.totals.securities).toBe(2);
        expect(bundle.totals.quoteCache).toBe(1);
        expect(bundle.totals.priceHistory).toBe(1);
        expect(bundle.totals.settings).toBe(1);
        expect(bundle.data.transactions).toHaveLength(3);
        expect(bundle.data.quoteCache[0].price).toBe('120');
        expect(bundle.data.settings[0].key).toBe('selectedPortfolio');
    });

    it('import replaces (does not merge) existing data', async () => {
        const importService = TestBed.inject(ImportService);
        await importService.importCsv(
            'pf-2',
            'extra.csv',
            '12-02-2026,10:00,12-02-2026,,,iDEAL,,EUR,"100,00",EUR,"100,00",',
        );
        expect(await db.transactions.count()).toBe(4);

        const bundle = await service.export();
        const report = await service.import(bundle);

        expect(report.added.transactions).toBe(4);
        expect(await db.transactions.count()).toBe(4);
        expect(await db.transactions.toArray().then((txns) => txns.map((t) => t.portfolioId))).toEqual([
            'pf-1',
            'pf-1',
            'pf-1',
            'pf-2',
        ]);

        await db.transactions.clear();
        await db.transaction('rw', db.transactions, async () => {
            await db.transactions.bulkPut(bundle.data.transactions);
        });
        expect(await db.transactions.count()).toBe(4);
        await service.import(bundle);
        expect(await db.transactions.count()).toBe(4);
    });

    it('roundtrip: import and export on a fresh DB preserves totals', async () => {
        await db.quoteCache.put({
            key: 'US0079031078',
            price: '120',
            currency: 'USD',
            timestamp: '2026-02-12T10:00:00Z',
            source: 'yahoo',
        });
        await db.priceHistory.bulkPut([
            { isin: 'US0079031078', date: '2026-02-12', close: '120', currency: 'USD' },
            { isin: 'US0079031078', date: '2026-02-13', close: '125', currency: 'USD' },
        ]);
        await db.fxCache.put({ pair: 'USD/EUR', date: '2026-02-12', rate: '0.92' });
        await db.settings.put({ key: 'selectedPortfolio', value: 'pf-1' });

        const bundle = await service.export();
        const json = JSON.stringify(bundle);

        const db2 = createDb();
        try {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db2 }] });
            const service2 = TestBed.inject(BackupService);

            const restored = parseBundle(json);
            await service2.import(restored);

            expect(await db2.transactions.count()).toBe(bundle.totals.transactions);
            expect(await db2.quoteCache.count()).toBe(bundle.totals.quoteCache);
            expect(await db2.priceHistory.count()).toBe(bundle.totals.priceHistory);
            expect(await db2.fxCache.count()).toBe(bundle.totals.fxCache);
            expect(await db2.settings.count()).toBe(bundle.totals.settings);
            expect(await db2.transactions.toArray()).toEqual(bundle.data.transactions);
            expect(await db2.quoteCache.toArray()).toEqual(bundle.data.quoteCache);

            const repository2 = TestBed.inject(TransactionRepository);
            const txns = await repository2.allForPortfolio('pf-1');
            expect(txns).toHaveLength(bundle.totals.transactions);
        } finally {
            db2.close();
        }
    });

    it('rejects import when schemaVersion is higher than the current version', async () => {
        const bundle = await service.export();
        const tooHigh = { ...bundle, schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
        await expect(service.import(tooHigh)).rejects.toThrow(BackupError);
        await expect(service.import(tooHigh)).rejects.toMatchObject({ code: 'unsupported-version' });
        expect(await db.transactions.count()).toBe(3);
    });

    it('rejects import when data is missing or not an object', () => {
        expect(() => validateBundle(null)).toThrow(BackupError);
        expect(() => validateBundle('string')).toThrow(BackupError);
        expect(() => validateBundle({ schemaVersion: 3 })).toThrow(/data block/);
        expect(() => validateBundle({ schemaVersion: 3, data: { portfolios: [] } })).toThrow(/transactions/);
    });

    it('rejects import when schemaVersion < 1', () => {
        expect(() => validateBundle({ schemaVersion: 0, data: emptyData() })).toThrow(BackupError);
        expect(() => validateBundle({ schemaVersion: 0, data: emptyData() })).toThrowError(/invalid schemaVersion/);
    });

    it('parseBundle accepts valid JSON and rejects junk', () => {
        const bundle = parseBundle(JSON.stringify({ schemaVersion: 3, data: emptyData() }));
        expect(bundle.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(() => parseBundle('not json')).toThrow(BackupError);
        expect(() => parseBundle('[]')).toThrow(BackupError);
    });

    it('normalizes legacy backup field names', () => {
        const legacy = {
            schemaVersion: 3,
            data: {
                ...emptyData(),
                portfolios: [{ id: 'pf-legacy', naam: 'Legacy', rapportagevaluta: 'EUR', aangemaaktOp: '2026-01-01' }],
                settings: [{ sleutel: 'selectedPortfolio', waarde: 'pf-legacy' }],
            },
        };
        const bundle = parseBundle(JSON.stringify(legacy));
        expect(bundle.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(bundle.data.portfolios[0]).toEqual({
            id: 'pf-legacy',
            name: 'Legacy',
            reportingCurrency: 'EUR',
            createdAt: '2026-01-01',
        });
        expect(bundle.data.settings[0]).toEqual({ key: 'selectedPortfolio', value: 'pf-legacy' });
    });
});

describe('BackupService end-to-end with the synthetic demo export', () => {
    const demoFile = join(process.cwd(), 'examples', 'demo', 'degiro-demo.csv');

    it('preserves demo positions through backup and restore', async () => {
        const db = createDb();
        try {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db }] });
            const importService = TestBed.inject(ImportService);
            const repository = TestBed.inject(TransactionRepository);

            const csv = readFileSync(demoFile, 'utf-8');
            await importService.importCsv('pf-demo', 'degiro-demo.csv', csv);

            const transactionsBefore = await repository.allForPortfolio('pf-demo');
            const positionsBefore = [...positionsAt(transactionsBefore.map(fromStored)).entries()].filter(
                ([, q]) => !q.isZero(),
            );
            expect(positionsBefore).toHaveLength(9);

            const service = TestBed.inject(BackupService);
            const bundle = await service.export();
            const db2 = createDb();
            try {
                TestBed.resetTestingModule();
                TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db2 }] });
                await TestBed.inject(BackupService).import(parseBundle(JSON.stringify(bundle)));

                const repository2 = TestBed.inject(TransactionRepository);
                const after = await repository2.allForPortfolio('pf-demo');
                expect(after).toHaveLength(transactionsBefore.length);
                const positionsAfter = [...positionsAt(after.map(fromStored)).entries()].filter(([, q]) => !q.isZero());
                expect(positionsAfter.map(([isin, q]) => [isin, q.toFixed()]).sort()).toEqual(
                    positionsBefore.map(([isin, q]) => [isin, q.toFixed()]).sort(),
                );
            } finally {
                db2.close();
            }
        } finally {
            db.close();
        }
    });
});

function emptyData(): Record<string, never[]> {
    return {
        portfolios: [],
        transactions: [],
        securities: [],
        securityAliases: [],
        importBatches: [],
        quoteCache: [],
        fxCache: [],
        priceHistory: [],
        splitEvents: [],
        settings: [],
    };
}
