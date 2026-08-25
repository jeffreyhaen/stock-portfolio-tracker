import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { BackupService, parseBundle } from '../../data/backup.service';
import { PortfolioDatabase } from '../../data/db';
import { ImportService } from '../../data/import.service';
import { MarketDataProvider } from '../../data/market-data-provider';
import { YahooMarketDataProvider } from '../../data/yahoo-market-data-provider';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';
import { seedMiniCsv, waitFor } from '../../../testing/seed';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
    let db: PortfolioDatabase;

    beforeEach(async () => {
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        await db.portfolios.add({
            id: 'p1',
            name: 'DEGIRO',
            reportingCurrency: 'EUR',
            lotStrategy: 'fifo',
            createdAt: new Date().toISOString(),
        });
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [SettingsPage, LocalizedNumberPipe, LocalizedDatePipe, ConfirmDialogComponent],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                { provide: MarketDataProvider, useClass: YahooMarketDataProvider },
                provideRouter([]),
            ],
        }).compileComponents();
        await seedMiniCsv(TestBed.inject(ImportService));
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        db.close();
    });

    it('roundtrips export → import → identical data via services', async () => {
        const backupService = TestBed.inject(BackupService);
        const bundle = await backupService.export();
        expect(bundle.totals.transactions).toBeGreaterThan(0);

        const fixture = TestBed.createComponent(SettingsPage);
        fixture.detectChanges();
        await waitFor(() => fixture.componentInstance.transactionCount() > 0);
        expect(fixture.componentInstance.schemaVersion).toBe(bundle.schemaVersion);

        const db2 = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        try {
            TestBed.resetTestingModule();
            await TestBed.configureTestingModule({
                providers: [
                    { provide: PortfolioDatabase, useValue: db2 },
                    { provide: MarketDataProvider, useClass: YahooMarketDataProvider },
                ],
            }).compileComponents();
            const service2 = TestBed.inject(BackupService);
            await service2.import(parseBundle(JSON.stringify(bundle)));
            expect(await db2.transactions.count()).toBe(bundle.totals.transactions);
        } finally {
            db2.close();
        }
    });

    it('saves the lot consumption strategy for the selected portfolio', async () => {
        const fixture = TestBed.createComponent(SettingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.selectedPortfolio() !== null && page.transactionCount() > 0);

        expect(page.strategyDraft()).toBe('fifo');
        expect(page.strategyDirty()).toBe(false);

        page.strategyDraft.set('lifo');
        expect(page.strategyDirty()).toBe(true);
        await page.saveLotStrategy();
        await waitFor(() => page.selectedPortfolio()?.lotStrategy === 'lifo');

        expect(page.strategyDirty()).toBe(false);
        expect((await db.portfolios.get('p1'))?.lotStrategy).toBe('lifo');
        expect(page.message()?.kind).toBe('success');
    });

    it('preview is ignored when the file is an invalid bundle', async () => {
        const fixture = TestBed.createComponent(SettingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.transactionCount() > 0);

        const file = new File(['this is not json'], 'invalid.json', { type: 'application/json' });
        await page.prepareImport(file);
        expect(page.pendingImport()).toBeNull();
        expect(page.message()?.kind).toBe('error');
    });

    it('preview is ignored when schemaVersion is too high', async () => {
        const backupService = TestBed.inject(BackupService);
        const bundle = await backupService.export();
        const tooHigh = { ...bundle, schemaVersion: bundle.schemaVersion + 1 };
        const json = JSON.stringify(tooHigh);

        const fixture = TestBed.createComponent(SettingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.transactionCount() > 0);

        const file = new File([json], 'toekomst.json', { type: 'future.json' });
        await page.prepareImport(file);
        expect(page.pendingImport()).toBeNull();
        expect(page.message()?.text).toContain('newer schema version');
    });
});
