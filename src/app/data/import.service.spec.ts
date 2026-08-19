import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { positionsAt } from '../domain/engine';
import { PortfolioDatabase } from './db';
import { ImportService } from './import.service';
import { fromStored } from './mappers';
import { TransactionRepository } from './transaction.repository';

const HEADER = 'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id';

const MINI_CSV = [
    HEADER,
    '12-02-2026,10:00,12-02-2026,AMD,US0079031078,"Koop 12 @ 100,00 USD",,USD,"-1200,00",USD,"100,00",aaaaaaaa-1111-1111-1111-111111111111',
    '12-02-2026,10:00,12-02-2026,AMD,US0079031078,"Koop 12 @ 100,00 USD",,USD,"-1200,00",USD,"100,00",aaaaaaaa-1111-1111-1111-111111111111',
    '01-03-2021,10:00,01-03-2021,AMD,US0079031078,"Koop 78 @ 80,00 USD",,USD,"-6240,00",USD,"820,00",aaaaaaaa-1111-1111-1111-111111111112',
    '01-01-2021,10:00,01-01-2021,,,iDEAL Deposit,,EUR,"50000,00",EUR,"50000,00",',
].join('\n');

describe('ImportService (IndexedDB)', () => {
    let db: PortfolioDatabase;
    let service: ImportService;

    beforeEach(async () => {
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db }] });
        service = TestBed.inject(ImportService);
    });

    afterEach(async () => {
        db.close();
    });

    it('imports a csv as a batch with ledger rows (legitimate duplicates are kept)', async () => {
        const report = await service.importCsv('pf-1', 'Account.csv', MINI_CSV);
        expect(report.rowCount).toBe(4);
        expect(report.added).toBe(4);
        expect(report.skippedDuplicates).toBe(0);
        expect(report.unknownTypes).toBe(0);
        expect(report.newSecurityIsins).toEqual(['US0079031078']);
        expect(await db.transactions.count()).toBe(4);
        const batches = await db.importBatches.toArray();
        expect(batches).toHaveLength(1);
        expect(batches[0].fileName).toBe('Account.csv');
    });

    it('reimport from the same csv adds nothing (count-based)', async () => {
        await service.importCsv('pf-1', 'Account.csv', MINI_CSV);
        const report = await service.importCsv('pf-1', 'Account.csv', MINI_CSV);
        expect(report.added).toBe(0);
        expect(report.skippedDuplicates).toBe(4);
        expect(report.newSecurityIsins).toEqual([]);
        expect(await db.transactions.count()).toBe(4);
    });

    it('incremental import only adds new rows', async () => {
        await service.importCsv('pf-1', 'Account-oud.csv', MINI_CSV);
        const nieuweRegel = '13-02-2026,09:00,13-02-2026,,,iDEAL Deposit,,EUR,"1000,00",EUR,"51000,00",';
        const report = await service.importCsv('pf-1', 'Account-nieuw.csv', `${MINI_CSV}\n${nieuweRegel}`);
        expect(report.added).toBe(1);
        expect(report.skippedDuplicates).toBe(4);
        expect(await db.transactions.count()).toBe(5);
    });

    it('skips securities with tradingCurrency', async () => {
        await service.importCsv('pf-1', 'Account.csv', MINI_CSV);
        const security = await db.securities.get('US0079031078');
        expect(security?.name).toBe('AMD');
        expect(security?.tradingCurrency).toBe('USD');
    });

    it('isolates portfolios from each other (dedup per portfolio)', async () => {
        await service.importCsv('pf-1', 'Account.csv', MINI_CSV);
        const report = await service.importCsv('pf-2', 'Account.csv', MINI_CSV);
        expect(report.added).toBe(4);
        expect(await db.transactions.count()).toBe(8);
    });
});

describe('ImportService with the synthetic demo export (end-to-end)', () => {
    const demoFile = join(process.cwd(), 'examples', 'demo', 'degiro-demo.csv');

    it('imports, rereads, reconciles, and deduplicates the demo ledger', async () => {
        const db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        try {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({ providers: [{ provide: PortfolioDatabase, useValue: db }] });
            const service = TestBed.inject(ImportService);
            const repository = TestBed.inject(TransactionRepository);

            const csv = readFileSync(demoFile, 'utf-8');
            const report = await service.importCsv('pf-demo', 'degiro-demo.csv', csv);
            expect(report.added).toBeGreaterThan(70);
            expect(report.unknownTypes).toBe(0);

            const stored = await repository.allForPortfolio('pf-demo');
            const positions = positionsAt(stored.map(fromStored));
            const open = [...positions.values()].filter((quantity) => !quantity.isZero());
            expect(open).toHaveLength(9);
            expect(positions.get('US0378331005')?.toFixed()).toBe('37');
            expect(positions.get('US67066G1040')?.toFixed()).toBe('100');

            const reimport = await service.importCsv('pf-demo', 'degiro-demo.csv', csv);
            expect(reimport.added).toBe(0);
            expect(reimport.skippedDuplicates).toBe(report.added);
        } finally {
            db.close();
        }
    });
});
