import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { PortfolioDatabase } from '../../data/db';
import { ImportService } from '../../data/import.service';
import { MarketDataProvider } from '../../data/market-data-provider';
import { PortfolioContext } from '../../data/portfolio-context';
import { YahooMarketDataProvider } from '../../data/yahoo-market-data-provider';
import { seedMiniCsv, waitFor } from '../../../testing/seed';
import { ForecastPage } from './forecast-page';

describe('ForecastPage', () => {
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
            imports: [ForecastPage],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                { provide: MarketDataProvider, useClass: YahooMarketDataProvider },
                provideRouter([]),
            ],
        }).compileComponents();
        await seedMiniCsv(TestBed.inject(ImportService));
    });

    async function createPage(): Promise<ForecastPage> {
        const fixture = TestBed.createComponent(ForecastPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.startPoint() !== null);
        return page;
    }

    it('projects the portfolio value with monthly compounding from the current value', async () => {
        const page = await createPage();
        await waitFor(() => page.returnDraft() !== '' && page.portfolioForecast() !== null);

        expect(page.yearsDraft()).toBe('10');
        const forecast = page.portfolioForecast()!;
        expect(forecast.points).toHaveLength(10 * 12 + 1);
        expect(forecast.points[0].value.toFixed(2)).toBe(page.startPoint()!.value.toFixed(2));
        expect(forecast.endValue.toFixed(2)).toBe(forecast.points[forecast.points.length - 1].value.toFixed(2));
        expect(forecast.endValue.greaterThan(forecast.points[0].value)).toBe(true);
        expect(page.chartSeries().map((s) => s.name)).toEqual(['Portfolio forecast']);
        expect(page.chartSeries()[0].points[0].value).toBeCloseTo(page.startPoint()!.value.toNumber(), 6);
        expect(page.cards().benchmarkDelta).toBeNull();

        expect(await TestBed.inject(PortfolioDatabase).settings.get('forecast:p1')).toBeUndefined();
    });

    it('compares with a benchmark scenario when a benchmark return is set', async () => {
        const db = TestBed.inject(PortfolioDatabase);
        await db.priceHistory.bulkPut([
            { isin: 'BENCH:VUSA.AS', date: '2024-01-02', close: '90', currency: 'EUR' },
            { isin: 'BENCH:VUSA.AS', date: '2026-02-14', close: '110', currency: 'EUR' },
        ]);
        await db.settings.put({ key: 'benchmark:p1', value: 'VUSA.AS' });
        const page = await createPage();
        await waitFor(() => page.benchmark.symbol() === 'VUSA.AS');
        await waitFor(() => page.returnDraft() !== '' && page.portfolioForecast() !== null);

        page.benchReturnDraft.set('6');
        expect(page.benchmarkForecast()).not.toBeNull();
        const portfolio = page.portfolioForecast()!;
        const benchmark = page.benchmarkForecast()!;
        expect(page.forecastDelta()!.toFixed(2)).toBe(portfolio.endValue.minus(benchmark.endValue).toFixed(2));
        expect(page.chartSeries().map((s) => s.name)).toEqual(['Portfolio forecast', 'VUSA.AS forecast']);
        expect(benchmark.endValue.greaterThan(benchmark.totalContributions)).toBe(true);
    });

    it('prefills the benchmark return from its annualized history', async () => {
        const db = TestBed.inject(PortfolioDatabase);
        await db.priceHistory.bulkPut([
            { isin: 'BENCH:VUSA.AS', date: '2020-01-02', close: '100', currency: 'EUR' },
            { isin: 'BENCH:VUSA.AS', date: '2026-01-02', close: '150', currency: 'EUR' },
        ]);
        await db.settings.put({ key: 'benchmark:p1', value: 'VUSA.AS' });
        const page = await createPage();
        await waitFor(() => page.benchmark.symbol() === 'VUSA.AS');
        await waitFor(() => page.benchReturnDraft() !== '');

        const parsed = Number(page.benchReturnDraft());
        expect(parsed).toBeGreaterThan(5);
        expect(parsed).toBeLessThan(10);
    });

    it('warns on incomplete valuation but keeps projecting from the last complete value', async () => {
        const page = await createPage();
        await TestBed.inject(ImportService).importCsv(
            'p1',
            'unknown.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '15-02-2026,10:00,15-02-2026,Mystery,XX0000000001,"SPIN-OFF: Koop 1 @ 10,00 XYZ",,XYZ,"0,00",XYZ,"0,00",dddddddd-1111-1111-1111-111111111111',
            ].join('\n'),
        );
        await TestBed.inject(PortfolioContext).refresh();

        expect(page.valuation().totals.complete).toBe(false);
        expect(page.valuationIncomplete()).toBe(false);
        expect(page.startPoint()!.date).toBe('2026-02-14');
        page.returnDraft.set('7');
        expect(page.portfolioForecast()).not.toBeNull();
    });

    it('warns and projects from the latest available value when valuation is incomplete', async () => {
        const context = TestBed.inject(PortfolioContext);
        const portfolio = await context.create('Partial', 'EUR');
        await TestBed.inject(ImportService).importCsv(
            portfolio.id,
            'spinoff.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '15-02-2026,10:00,15-02-2026,Mystery,XX0000000001,"SPIN-OFF: Koop 1 @ 10,00 XYZ",,XYZ,"0,00",XYZ,"0,00",dddddddd-1111-1111-1111-111111111111',
            ].join('\n'),
        );
        context.select(portfolio.id);
        const fixture = TestBed.createComponent(ForecastPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => page.valuationIncomplete());

        expect(page.valuation().totals.complete).toBe(false);
        expect(page.startPoint()).not.toBeNull();
        expect(page.forecastInputs().error).toBeNull();
        page.returnDraft.set('7');
        expect(page.portfolioForecast()).not.toBeNull();
    });

    it('validates the horizon', async () => {
        const page = await createPage();
        await waitFor(() => page.returnDraft() !== '' && page.portfolioForecast() !== null);

        page.yearsDraft.set('0');
        expect(page.forecastInputs().error).toContain('Horizon');
        expect(page.portfolioForecast()).toBeNull();

        page.yearsDraft.set('25');
        page.monthlyDraft.set('250');
        page.returnDraft.set('7');
        expect(page.forecastInputs().error).toBeNull();
        expect(page.portfolioForecast()!.points).toHaveLength(25 * 12 + 1);
    });
});
