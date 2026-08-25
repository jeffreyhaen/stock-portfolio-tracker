import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from '../../data/db';
import { ImportService } from '../../data/import.service';
import { seedMiniCsv, waitFor } from '../../../testing/seed';
import { CashPage } from './cash-page';

describe('CashPage', () => {
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
            imports: [CashPage],
            providers: [{ provide: PortfolioDatabase, useValue: db }, provideRouter([])],
        }).compileComponents();
        await seedMiniCsv(TestBed.inject(ImportService));
    });

    it('shows balances per currency based on the balance anchor', async () => {
        const fixture = TestBed.createComponent(CashPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.balances().length > 0);

        const balances = page.balances();
        const eur = balances.find((b) => b.currency === 'EUR');
        expect(eur?.name).toBe('Euro');
        expect(eur?.balance.toFixed(2)).toBe('48500.00');
        const usd = balances.find((b) => b.currency === 'USD');
        expect(usd?.balance.toFixed(2)).toBe('-900.00');
        expect(usd?.balanceReporting?.toFixed(2)).toBe('-750.00');
        expect(usd?.balanceReportingEstimated).toBe(true);
    });

    it('shows external flows (deposits/withdrawals)', async () => {
        const fixture = TestBed.createComponent(CashPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.flows().length > 0);

        const flows = page.flows();
        expect(flows).toHaveLength(1);
        expect(flows[0].currency).toBe('EUR');
        expect(flows[0].deposits.toFixed(2)).toBe('50000.00');
        expect(flows[0].withdrawals.toFixed(2)).toBe('0.00');
    });
});
