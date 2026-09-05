import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { routes } from './app.routes';
import { PortfolioDatabase } from './data/db';

describe('app routes', () => {
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
            providers: [{ provide: PortfolioDatabase, useValue: db }, provideRouter(routes)],
        }).compileComponents();
    });

    it('serves /projection and /prices outside the portfolio route', async () => {
        const router = TestBed.inject(Router);
        await router.navigateByUrl('/projection');
        expect(router.url).toBe('/projection');
        await router.navigateByUrl('/prices');
        expect(router.url).toBe('/prices');
    });

    it('redirects the legacy portfolio-scoped URLs', async () => {
        const router = TestBed.inject(Router);
        await router.navigateByUrl('/portfolio/p1/projection');
        expect(router.url).toBe('/projection');
        await router.navigateByUrl('/portfolio/p1/prices');
        expect(router.url).toBe('/prices');
    });
});
