import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { App } from './app';
import { routes } from './app.routes';
import { PortfolioDatabase } from './data/db';
import { PortfolioContext } from './data/portfolio-context';
import { MarketDataService } from './data/market-data.service';
import { MarketDataSyncService } from './data/market-data-sync.service';
import { waitFor } from '../testing/seed';

describe('App', () => {
    let refreshDates: string[];

    beforeEach(async () => {
        refreshDates = [];
        const db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        await db.portfolios.add({
            id: 'p1',
            name: 'DEGIRO',
            reportingCurrency: 'EUR',
            lotStrategy: 'fifo',
            createdAt: new Date().toISOString(),
        });
        await TestBed.configureTestingModule({
            imports: [App],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                {
                    provide: MarketDataSyncService,
                    useValue: {
                        refreshAllIfNeeded: async (fromDate: string) => {
                            refreshDates.push(fromDate);
                            return null;
                        },
                    },
                },
                provideRouter([]),
            ],
        }).compileComponents();
    });

    it('creates the app shell', () => {
        const fixture = TestBed.createComponent(App);
        expect(fixture.componentInstance).toBeTruthy();
    });

    it('refreshes quotes after startup data is ready', async () => {
        const fixture = TestBed.createComponent(App);
        fixture.detectChanges();
        await waitFor(() => refreshDates.length === 1);
        expect(refreshDates[0]).toBe(localToday());
    });

    it('loads the static cache before starting the optional remote refresh', async () => {
        const order: string[] = [];
        let releaseCache = (): void => undefined;
        const ready = new Promise<void>((resolve) => {
            releaseCache = () => {
                order.push('cache');
                resolve();
            };
        });
        TestBed.overrideProvider(MarketDataService, { useValue: { ready } });
        TestBed.overrideProvider(MarketDataSyncService, {
            useValue: {
                refreshAllIfNeeded: async () => {
                    order.push('remote');
                    return null;
                },
            },
        });

        TestBed.createComponent(App).detectChanges();
        await Promise.resolve();
        expect(order).toEqual([]);
        releaseCache();
        await waitFor(() => order.length === 2);
        expect(order).toEqual(['cache', 'remote']);
    });

    it('shows the main navigation and hides the portfolio tab row off-portfolio', async () => {
        const fixture = TestBed.createComponent(App);
        fixture.detectChanges();
        await waitFor(() => TestBed.inject(PortfolioContext).selectedPortfolioId() !== '');
        fixture.detectChanges();
        const navs = fixture.nativeElement.querySelectorAll('nav');
        expect(navs.length).toBe(1);
        const mainNav = navs[0] as HTMLElement;
        expect(mainNav.textContent).toContain('Portfolio: DEGIRO');
        expect(mainNav.textContent).toContain('Tools');
        expect(mainNav.textContent).toContain('Settings');
    });
});

describe('App portfolio tab row', () => {
    beforeEach(async () => {
        const db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        await db.portfolios.add({
            id: 'p1',
            name: 'DEGIRO',
            reportingCurrency: 'EUR',
            lotStrategy: 'fifo',
            createdAt: new Date().toISOString(),
        });
        await TestBed.configureTestingModule({
            imports: [App],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                {
                    provide: MarketDataSyncService,
                    useValue: { refreshAllIfNeeded: async () => null },
                },
                provideRouter(routes),
            ],
        }).compileComponents();
    });

    it('shows the portfolio tab row only on portfolio pages', async () => {
        const fixture = TestBed.createComponent(App);
        fixture.detectChanges();
        const router = TestBed.inject(Router);
        await router.navigateByUrl('/portfolio/p1/dashboard');
        await waitFor(() => TestBed.inject(PortfolioContext).selectedPortfolioId() !== '');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('nav').length).toBe(2);
        await router.navigateByUrl('/prices');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('nav').length).toBe(1);
        await router.navigateByUrl('/portfolio/p1/holdings');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('nav').length).toBe(2);
    });
});

function localToday(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
