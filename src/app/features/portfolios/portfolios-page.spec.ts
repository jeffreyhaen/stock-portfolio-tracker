import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from '../../data/db';
import { MarketDataSyncService } from '../../data/market-data-sync.service';
import { PortfoliosPage } from './portfolios-page';

const MINI_CSV = [
    'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
    '12-02-2026,10:00,12-02-2026,AMD,US0079031078,"Koop 12 @ 100,00 USD",,USD,"-1200,00",USD,"100,00",aaaaaaaa-1111-1111-1111-111111111111',
    '01-01-2021,10:00,01-01-2021,,,iDEAL Deposit,,EUR,"50000,00",EUR,"50000,00",',
].join('\n');

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(predicate()).toBe(true);
}

class MarketDataSyncServiceStub {
    readonly calls: { fromDate: string; onlyIsins: readonly string[] | undefined }[] = [];
    autoLinkError: Error | null = null;
    autoLinkGate: Promise<void> | null = null;
    serviceUnavailable = false;

    async autoLink(fromDate: string, onlyIsins?: readonly string[]) {
        this.calls.push({ fromDate, onlyIsins });
        if (this.autoLinkGate !== null) {
            await this.autoLinkGate;
        }
        if (this.autoLinkError !== null) {
            throw this.autoLinkError;
        }
        return { linked: [], noCandidate: [], serviceUnavailable: this.serviceUnavailable };
    }
}

describe('PortfoliosPage', () => {
    let db: PortfolioDatabase;
    let marketDataSync: MarketDataSyncServiceStub;

    beforeEach(async () => {
        db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        marketDataSync = new MarketDataSyncServiceStub();
        await TestBed.configureTestingModule({
            imports: [PortfoliosPage],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                { provide: MarketDataSyncService, useValue: marketDataSync },
                provideRouter([]),
            ],
        }).compileComponents();
    });

    it('creates a portfolio and imports a csv', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await fixture.whenStable();
        expect(page.portfolios()).toEqual([]);

        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);
        expect(page.selectedPortfolioId()).toBe(page.portfolios()[0].id);

        await page.importCsvText('Account.csv', MINI_CSV);
        await waitFor(() => page.autoLinkResult() !== null);
        const report = page.report();
        expect(report).not.toBeNull();
        expect(report?.added).toBe(2);
        expect(page.batches()).toHaveLength(1);
        expect(page.error()).toBeNull();
        expect(marketDataSync.calls).toEqual([{ fromDate: '2021-01-01', onlyIsins: ['US0079031078'] }]);
        expect(page.autoLinkResult()).toEqual({ tone: 'info', text: 'Auto-link completed: 0 linked' });
    });

    it('shows a clear warning when the market data service is unavailable during import', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);
        marketDataSync.serviceUnavailable = true;

        await page.importCsvText('Account.csv', MINI_CSV);
        await waitFor(() => page.autoLinkResult() !== null);

        expect(page.autoLinkResult()).toMatchObject({ tone: 'warning' });
        expect(page.autoLinkResult()?.text).toContain('Market data service unavailable');
        expect(page.autoLinkResult()?.text).toContain('Imported and cached data and manual prices remain usable');
        expect(page.autoLinkResult()?.text).toContain('local market-data proxy is optional');
        expect(page.autoLinkResult()?.text).toContain('No ticker searches were completed');
        expect(page.report()).not.toBeNull();
    });

    it('does not auto-link when an import adds no new securities', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);

        await page.importCsvText('Account.csv', MINI_CSV);
        await page.importCsvText('Account-again.csv', MINI_CSV);

        expect(marketDataSync.calls).toHaveLength(1);
    });

    it('keeps the import result when auto-link fails', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);
        marketDataSync.autoLinkError = new Error('search unavailable');

        await page.importCsvText('Account.csv', MINI_CSV);
        await waitFor(() => page.autoLinkResult() !== null);

        expect(page.report()).not.toBeNull();
        expect(page.autoLinkResult()).toEqual({ tone: 'warning', text: 'Auto-link failed: search unavailable' });
        expect(page.error()).toBeNull();
        expect(await db.transactions.count()).toBe(2);
    });

    it('does not keep an imported portfolio busy while optional auto-link is pending', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);
        let release = (): void => undefined;
        marketDataSync.autoLinkGate = new Promise<void>((resolve) => {
            release = resolve;
        });

        await page.importCsvText('Account.csv', MINI_CSV);

        fixture.detectChanges();
        expect(page.report()).not.toBeNull();
        expect(page.busy()).toBe(false);
        expect(page.importPhase()).toBe('linking');
        expect(fixture.nativeElement.textContent).toContain('Linking tickers…');
        expect(page.batches()).toHaveLength(1);
        release();
        await waitFor(() => page.autoLinkResult() !== null);
        expect(page.importPhase()).toBe('importing');
    });

    it('does not publish detached auto-link status after the portfolio selection changes', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        let release = (): void => undefined;
        marketDataSync.autoLinkGate = new Promise<void>((resolve) => {
            release = resolve;
        });

        await page.importCsvText('Account.csv', MINI_CSV);
        await db.portfolios.add({
            id: 'p2',
            name: 'Other',
            reportingCurrency: 'EUR',
            createdAt: new Date().toISOString(),
        });
        await page.context.refresh();
        page.onPortfolioChange('p2');
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(marketDataSync.calls[0].fromDate).toBe('2021-01-01');
        expect(page.autoLinkResult()).toBeNull();
    });

    it('does not let an older auto-link overwrite a newer import status', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        let release = (): void => undefined;
        marketDataSync.autoLinkGate = new Promise<void>((resolve) => {
            release = resolve;
        });

        await page.importCsvText('Account.csv', MINI_CSV);
        await page.importCsvText('Account-again.csv', MINI_CSV);
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(page.report()?.added).toBe(0);
        expect(page.autoLinkResult()).toBeNull();
    });

    it('renders each portfolio row as a selectable, hand-cursor card', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);

        await db.portfolios.add({
            id: 'p2',
            name: 'Broker',
            reportingCurrency: 'EUR',
            createdAt: new Date().toISOString(),
        });
        await page.context.refresh();
        fixture.detectChanges();

        const rows = fixture.nativeElement.querySelectorAll('li[role="button"]') as NodeListOf<HTMLElement>;
        expect(rows).toHaveLength(2);
        rows.forEach((row) => {
            expect(row.className).toContain('cursor-pointer');
            expect(row.getAttribute('aria-pressed')).toBeTruthy();
            expect(row.getAttribute('tabindex')).toBe('0');
        });
    });

    it('cancels an in-flight rename when the selection changes', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);

        const portfolio = page.portfolios()[0];
        page.startRename(portfolio);
        page.editingPortfolioName.set('Draft name');
        page.onPortfolioChange(portfolio.id);

        expect(page.editingPortfolioId()).toBeNull();
        expect(page.editingPortfolioName()).toBe('');
    });

    it('renames a portfolio', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);

        const portfolio = page.portfolios()[0];
        page.startRename(portfolio);
        page.editingPortfolioName.set('Broker portfolio');
        await page.renamePortfolio(portfolio);

        expect(page.portfolios()[0].name).toBe('Broker portfolio');
        expect((await db.portfolios.get(portfolio.id))?.name).toBe('Broker portfolio');
        expect(page.editingPortfolioId()).toBeNull();
    });

    it('shows an error message for a corrupt csv', async () => {
        const fixture = TestBed.createComponent(PortfoliosPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        page.newPortfolioName.set('DEGIRO');
        await page.createPortfolio();
        await waitFor(() => page.portfolios().length === 1);

        const corrupt = ['Datum,Tijd', '31-08-2025,10:00', ',,,FRAGMENT,,,,,,,,'].join('\n');
        await page.importCsvText('kapot.csv', corrupt);
        expect(page.report()).toBeNull();
        expect(page.error()).toContain('Unexpected corruption');
        expect(await db.transactions.count()).toBe(0);
    });
});
