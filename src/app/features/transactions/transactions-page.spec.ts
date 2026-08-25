import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from '../../data/db';
import { ImportService } from '../../data/import.service';
import { seedMiniCsv, waitFor } from '../../../testing/seed';
import { TransactionsPage } from './transactions-page';

describe('TransactionsPage', () => {
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
            imports: [TransactionsPage],
            providers: [{ provide: PortfolioDatabase, useValue: db }, provideRouter([])],
        }).compileComponents();
        await seedMiniCsv(TestBed.inject(ImportService));
    });

    it('shows transactions newest first with labels and badges', async () => {
        const fixture = TestBed.createComponent(TransactionsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.transactions().length > 0);

        const rows = page.transactions();
        expect(rows).toHaveLength(4);
        expect(rows[0].date).toBe('2026-02-14');
        expect(rows[0].label).toBe('Buy');
        expect(rows.map((r) => r.label)).toContain('Deposit');

        const amdSell = rows.find((r) => r.quantity?.toFixed(0) === '2');
        expect(amdSell?.label).toBe('Sell');
        expect(amdSell?.mutation?.toFixed(2)).toBe('300.00');
        expect(amdSell?.mutationCurrency).toBe('USD');
    });

    it('shows amount in reportingCurrency prominently and original currency subtly when they differ', async () => {
        const fixture = TestBed.createComponent(TransactionsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.transactions().length > 0);

        const rows = page.transactions();
        expect(page.reportingCurrency()).toBe('EUR');

        const amdPurchase = rows.find((r) => r.product === 'AMD' && r.label === 'Buy');
        expect(amdPurchase?.mutation?.toFixed(2)).toBe('-1200.00');
        expect(amdPurchase?.mutationCurrency).toBe('USD');
        expect(amdPurchase?.mutationReporting?.toFixed(2)).toBe('-1000.00');
        expect(amdPurchase?.mutationReportingCurrency).toBe('EUR');
        expect(amdPurchase?.showOriginalMutation).toBe(true);

        const amdSell = rows.find((r) => r.quantity?.toFixed(0) === '2');
        expect(amdSell?.mutationReporting?.toFixed(2)).toBe('250.00');
        expect(amdSell?.showOriginalMutation).toBe(true);

        const asml = rows.find((r) => r.product === 'ASML Holding NV ADR');
        expect(asml?.mutationCurrency).toBe('EUR');
        expect(asml?.mutationReportingCurrency).toBe('EUR');
        expect(asml?.showOriginalMutation).toBe(false);

        const deposit = rows.find((r) => r.label === 'Deposit');
        expect(deposit?.mutationCurrency).toBe('EUR');
        expect(deposit?.showOriginalMutation).toBe(false);
    });

    it('shows null reporting-currency amount when FX is missing but keeps the original currency', async () => {
        const importService = TestBed.inject(ImportService);
        await importService.importCsv(
            'p1',
            'gbp.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '20-02-2026,11:00,20-02-2026,VUSA,IE00B3XXRP09,"Koop 4 @ 80,00 GBP",,GBP,"-320,00",GBP,"-320,00",eeeeeeee-1111-1111-1111-111111111111',
            ].join('\n'),
        );

        const fixture = TestBed.createComponent(TransactionsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.transactions().some((r) => r.product === 'VUSA'));

        const vusa = page.transactions().find((r) => r.product === 'VUSA');
        expect(vusa?.mutationCurrency).toBe('GBP');
        expect(vusa?.mutation?.toFixed(2)).toBe('-320.00');
        expect(vusa?.mutationReporting).toBeNull();
        expect(vusa?.mutationReportingCurrency).toBe('EUR');
        expect(vusa?.showOriginalMutation).toBe(true);
    });

    it('filters by type and search term', async () => {
        const fixture = TestBed.createComponent(TransactionsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.transactions().length > 0);

        page.onTypeFilter('TRADE_SELL');
        expect(page.transactions().map((r) => r.label)).toEqual(['Sell']);

        page.onTypeFilter('ALL');
        page.onSearch('asml');
        expect(page.transactions()).toHaveLength(1);
        expect(page.totalCount()).toBe(1);

        page.onSearch('US0079031078');
        expect(page.transactions()).toHaveLength(2);
    });
});
