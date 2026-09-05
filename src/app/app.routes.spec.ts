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

    it('does not serve the legacy portfolio-scoped URLs anymore', async () => {
        const router = TestBed.inject(Router);
        await expect(router.navigateByUrl('/portfolio/p1/prices')).rejects.toThrow();
        await expect(router.navigateByUrl('/portfolio/p1/projection')).rejects.toThrow();
    });
});
