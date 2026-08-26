import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { of } from 'rxjs';
import { PortfolioDatabase } from '../../data/db';
import { ImportService } from '../../data/import.service';
import { seedMiniCsv, waitFor } from '../../../testing/seed';
import { HoldingDetailPage } from './holding-detail-page';

describe('HoldingDetailPage', () => {
    async function setup(isin: string): Promise<void> {
        const db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        await db.portfolios.add({
            id: 'p1',
            name: 'DEGIRO',
            reportingCurrency: 'EUR',
            lotStrategy: 'fifo',
            createdAt: new Date().toISOString(),
        });
        await TestBed.configureTestingModule({
            imports: [HoldingDetailPage],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: { paramMap: of(convertToParamMap({ isin })) },
                },
            ],
        }).compileComponents();
        await seedMiniCsv(TestBed.inject(ImportService));
    }

    it('shows header stats, open lots and realized per sale for a partially sold holding', async () => {
        await setup('US0079031078');
        const fixture = TestBed.createComponent(HoldingDetailPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.header() !== null && page.lots().length > 0);

        const header = page.header();
        expect(header?.product).toBe('AMD');
        expect(header?.open).toBe(true);
        expect(header?.quantity.toFixed(0)).toBe('10');
        expect(header?.costBasis?.toFixed(2)).toBe('833.33');
        expect(header?.costPerShare?.toFixed(2)).toBe('83.33');
        expect(header?.currentPrice?.toFixed(2)).toBe('125.00');
        expect(header?.value?.toFixed(2)).toBe('1250.00');
        expect(header?.unrealizedPnl?.toFixed(2)).toBe('416.67');
        expect(header?.unrealizedPnlPct?.toFixed(2)).toBe('50.00');
        expect(header?.realizedPnl?.toFixed(2)).toBe('83.33');
        expect(header?.realizedCount).toBe(1);
        expect(header?.priceLabel).toBe('Estimated price');

        const total = page.totalReturn();
        expect(total).not.toBeNull();
        expect(total?.pct.toNumber()).toBeGreaterThan(40);
        expect(total?.years.toNumber()).toBeGreaterThan(0);
        expect(page.simpleTotalReturnPct()?.toFixed(2)).toBe('50.00');
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Money-weighted');

        const lot = page.lots()[0];
        expect(lot.acquiredAt).toBe('2026-02-12');
        expect(lot.quantity.toFixed(0)).toBe('10');
        expect(lot.costBasis.toFixed(2)).toBe('833.33');
        expect(lot.value?.toFixed(2)).toBe('1250.00');
        expect(lot.pnl?.toFixed(2)).toBe('416.67');

        const closed = page.closedLots();
        expect(closed).toHaveLength(1);
        expect(closed[0].soldAt).toBe('2026-02-13');
        expect(closed[0].quantity.toFixed(0)).toBe('2');
        expect(closed[0].acquiredAt).toBe('2026-02-12');
        expect(closed[0].costBasis.toFixed(2)).toBe('166.67');
        expect(closed[0].proceeds?.toFixed(2)).toBe('250.00');
        expect(closed[0].pnl?.toFixed(2)).toBe('83.33');

        expect(page.holdingTransactions()).toHaveLength(2);
        expect(page.holdingTransactions().map((txn) => txn.label)).toEqual(['Sell', 'Buy']);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Open lots');
        expect(fixture.nativeElement.textContent).toContain('Closed lots');
    });

    it('sorts open lots newest first by default and toggles per column', async () => {
        await setup('USN070592100');
        await TestBed.inject(ImportService).importCsv(
            'p1',
            'asml-extra-buy.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '01-03-2026,10:00,01-03-2026,ASML Holding NV ADR,USN070592100,"Koop 1 @ 600,00 EUR",,EUR,"-600,00",EUR,"47900,00",',
            ].join('\n'),
        );
        const fixture = TestBed.createComponent(HoldingDetailPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.lots().length === 2);

        expect(page.lots().map((lot) => lot.acquiredAt)).toEqual(['2026-03-01', '2026-02-14']);

        page.lotSort.toggle('quantity');
        expect(page.lots().map((lot) => lot.quantity.toFixed(0))).toEqual(['1', '3']);
        page.lotSort.toggle('quantity');
        expect(page.lots().map((lot) => lot.quantity.toFixed(0))).toEqual(['3', '1']);

        page.lotSort.toggle('pnlPct');
        const byPct = page.lots().map((lot) => lot.pnlPct?.toFixed(2));
        expect(byPct).toEqual([...byPct].sort());
        page.lotSort.toggle('pnlPct');
        expect(page.lots().map((lot) => lot.pnlPct?.toFixed(2))).toEqual([...byPct].reverse());

        expect(page.closedLots()).toHaveLength(0);
        const header = page.header();
        expect(header?.realizedPnl?.toFixed(2)).toBe('0.00');
        expect(header?.realizedCount).toBe(0);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).not.toContain('Closed lots');
    });

    it('shows a not-found state for an unknown isin', async () => {
        await setup('XX9999999999');
        const fixture = TestBed.createComponent(HoldingDetailPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.portfolioId() !== '');

        expect(page.header()).toBeNull();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Holding not found');
    });
});
