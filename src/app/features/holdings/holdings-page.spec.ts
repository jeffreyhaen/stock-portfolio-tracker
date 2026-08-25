import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from '../../data/db';
import { ImportService } from '../../data/import.service';
import { seedMiniCsv, waitFor } from '../../../testing/seed';
import { HoldingsPage } from './holdings-page';

describe('HoldingsPage', () => {
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
            imports: [HoldingsPage],
            providers: [{ provide: PortfolioDatabase, useValue: db }, provideRouter([])],
        }).compileComponents();
        await seedMiniCsv(TestBed.inject(ImportService));
    });

    it('shows open positions with net investment in reportingCurrency', async () => {
        const fixture = TestBed.createComponent(HoldingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.holdings().length > 0);

        const holdings = page.holdings();
        expect(holdings.map((h) => h.isin).sort()).toEqual(['US0079031078', 'USN070592100']);

        const amd = holdings.find((h) => h.isin === 'US0079031078');
        expect(amd?.quantity.toFixed(0)).toBe('10');
        expect(amd?.netInvested?.toFixed(2)).toBe('833.33');
        expect(amd?.netInvestedPerShare?.toFixed(2)).toBe('83.33');
        expect(amd?.realizedPnl?.toFixed(2)).toBe('83.33');
        expect(amd?.periodDays).not.toBeNull();
        expect(amd?.value?.toFixed(2)).toBe('1250.00');
        expect(amd?.pnl?.toFixed(2)).toBe('416.67');
        expect(amd?.priceProvenance).toBe('trade');
        expect(amd?.priceLabel).toBeNull();
        expect(page.valuationStatus()).toBe(
            'Estimated: 2 latest-trade prices · Estimated FX: 1 imported exchange rate',
        );

        const asml = holdings.find((h) => h.isin === 'USN070592100');
        expect(asml?.netInvested?.toFixed(2)).toBe('1500.00');
        expect(asml?.realizedPnl?.toFixed(2)).toBe('0.00');
        fixture.detectChanges();
        const links = [...fixture.nativeElement.querySelectorAll('td a')] as HTMLAnchorElement[];
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
            '/portfolio/p1/holdings/USN070592100',
            '/portfolio/p1/holdings/US0079031078',
        ]);
        expect(fixture.nativeElement.querySelectorAll('app-info-tooltip')).toHaveLength(2);
        const tooltip = fixture.nativeElement.querySelector('app-info-tooltip .tooltip');
        expect(tooltip?.classList.contains('tooltip-end')).toBe(true);
        expect(tooltip?.getAttribute('data-tip')).toContain('Estimated from the latest trade price');
    });

    it('shows value, p&l and allocation as soon as quotes are available', async () => {
        const db = TestBed.inject(PortfolioDatabase);
        await db.quoteCache.put({
            key: 'US0079031078',
            price: '120',
            currency: 'USD',
            timestamp: new Date().toISOString(),
            source: 'yahoo',
        });
        await db.fxCache.put({ pair: 'USD/EUR', date: '2026-02-13', rate: '0.9' });
        const fixture = TestBed.createComponent(HoldingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.holdings().some((h) => h.value !== null));

        const amd = page.holdings().find((h) => h.isin === 'US0079031078');
        expect(amd?.value?.toFixed(2)).toBe('1080.00');
        expect(amd?.valuePerShare?.toFixed(2)).toBe('108.00');
        expect(amd?.pnl?.toFixed(2)).toBe('246.67');
        expect(amd?.pnlPct?.toFixed(2)).toBe('29.60');
        expect(amd?.pnlInclRealized?.toFixed(2)).toBe('330.00');
        expect(amd?.allocationPct?.toFixed(2)).toBe('41.86');
        expect(amd?.priceProvenance).toBe('market');
        expect(amd?.priceLabel).toBeNull();
        const windowDays = Math.round((Date.now() - Date.parse('2026-02-12T00:00:00Z')) / 86_400_000);
        if (windowDays < 365) {
            expect(amd?.pnlPctYear).toBeNull();
        } else {
            expect(amd?.pnlPctYear).not.toBeNull();
        }
    });

    it('labels an open zero-cash spin-off basis and P&L as unavailable', async () => {
        await TestBed.inject(ImportService).importCsv(
            'p1',
            'spin-off.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '15-02-2026,10:00,15-02-2026,SpinCo,XX0000000001,"SPIN-OFF: Koop 2 @ 10,00 EUR",,EUR,"0,00",EUR,"48500,00",eeeeeeee-1111-1111-1111-111111111111',
            ].join('\n'),
        );
        const fixture = TestBed.createComponent(HoldingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.holdings().some((holding) => holding.isin === 'XX0000000001'));

        const spinOff = page.holdings().find((holding) => holding.isin === 'XX0000000001');
        expect(spinOff?.quantity.toFixed(0)).toBe('2');
        expect(spinOff?.netInvested).toBeNull();
        expect(spinOff?.realizedPnl?.toFixed(2)).toBe('0.00');
        expect(spinOff?.realizedBasisAssumedZero).toBe(false);
        expect(spinOff?.pnl).toBeNull();
        expect(spinOff?.pnlPctYear).toBeNull();
        expect(spinOff?.basisUnavailableText).toContain('Cost basis is unavailable');
        expect(spinOff?.realizedUnavailableText).toBeNull();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Basis unavailable');
        expect(fixture.nativeElement.textContent).toContain('P&L unavailable');
        const tips = [...fixture.nativeElement.querySelectorAll('app-info-tooltip .tooltip')] as HTMLElement[];
        expect(tips.some((tip) => tip.getAttribute('data-tip')?.includes('spin-off'))).toBe(true);
    });

    it('warns when closed realized P&L uses broker-assumed zero spin-off basis', async () => {
        await TestBed.inject(ImportService).importCsv(
            'p1',
            'sold-spin-off.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '14-02-2026,10:00,14-02-2026,SpinCo,XX0000000002,"SPIN-OFF: Koop 2 @ 0,00 EUR",,EUR,"0,00",EUR,"48500,00",',
                '15-02-2026,10:00,15-02-2026,SpinCo,XX0000000002,"Verkoop 2 @ 56,56 EUR",,EUR,"113,12",EUR,"48613,12",ffffffff-2222-2222-2222-222222222222',
            ].join('\n'),
        );
        const fixture = TestBed.createComponent(HoldingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.closedCount() > 0);
        page.setFilter('closed');

        const spinOff = page.holdings().find((holding) => holding.isin === 'XX0000000002');
        expect(spinOff?.realizedPnl?.toFixed(2)).toBe('113.12');
        expect(spinOff?.realizedBasisAssumedZero).toBe(true);
        expect(spinOff?.basisUnavailableText).toContain('Cost basis is unavailable');
        expect(spinOff?.realizedUnavailableText).toBeNull();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('€ 113,12');
        const tooltips = [...fixture.nativeElement.querySelectorAll('app-info-tooltip .tooltip')] as HTMLElement[];
        const tooltip = tooltips.find((tip) => tip.getAttribute('data-tip')?.includes('assumes zero'));
        expect(tooltip?.getAttribute('data-tip')).toContain('assumes zero recorded spin-off basis');
        expect(tooltip?.getAttribute('data-tip')).toContain('economic cost basis is unavailable');
    });

    it('labels oversold closed holding realized P&L as unavailable', async () => {
        await TestBed.inject(ImportService).importCsv(
            'p1',
            'oversell.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '15-02-2026,10:00,15-02-2026,AMD,US0079031078,"Verkoop 99 @ 150,00 USD","1,2000",USD,"14850,00",USD,"13950,00",ffffffff-1111-1111-1111-111111111111',
            ].join('\n'),
        );
        const fixture = TestBed.createComponent(HoldingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.closedCount() > 0);
        page.setFilter('closed');

        const amd = page.holdings().find((holding) => holding.isin === 'US0079031078');
        expect(amd?.open).toBe(false);
        expect(amd?.realizedPnl).toBeNull();
        expect(amd?.basisUnavailableText).toBeNull();
        expect(amd?.realizedUnavailableText).toContain('oversell');
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Realized unavailable');
        const tooltip = fixture.nativeElement.querySelector('app-info-tooltip .tooltip');
        expect(tooltip?.getAttribute('data-tip')).toContain('oversell');
    });

    it('filters closed positions via the toggle and shows 0% allocation for closed', async () => {
        const importService = TestBed.inject(ImportService);
        await importService.importCsv(
            'p1',
            'sell.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '15-02-2026,10:00,15-02-2026,ASML Holding NV ADR,USN070592100,"Verkoop 3 @ 600,00 EUR",,EUR,"1800,00",EUR,"50300,00",dddddddd-1111-1111-1111-111111111111',
            ].join('\n'),
        );
        const fixture = TestBed.createComponent(HoldingsPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.closedCount() > 0);

        expect(page.openCount()).toBe(1);
        expect(page.closedCount()).toBe(1);
        expect(page.holdings().map((h) => h.isin)).toEqual(['US0079031078']);

        page.setFilter('closed');
        const closed = page.holdings();
        expect(closed).toHaveLength(1);
        expect(closed[0].allocationPct?.toFixed(0)).toBe('0');
        expect(closed[0].realizedPnl?.toFixed(2)).toBe('300.00');
        expect(closed[0].marketDataWarning).toBe(false);
        expect(closed[0].priceProvenance).toBeNull();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('app-info-tooltip')).toHaveLength(0);
        expect(closed[0].pnlPct?.toFixed(2)).toBe('20.00');
        expect(closed[0].pnlPctYear).toBeNull();
        expect(closed[0].periodDays).toBe(1);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('1 day');

        page.setFilter('all');
        expect(page.holdings()).toHaveLength(2);
    });
});
