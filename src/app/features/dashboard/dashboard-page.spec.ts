import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PortfolioDatabase } from '../../data/db';
import { ImportService } from '../../data/import.service';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { QuoteService } from '../../data/quote.service';
import { MarketDataProvider } from '../../data/market-data-provider';
import { YahooMarketDataProvider } from '../../data/yahoo-market-data-provider';
import Decimal from 'decimal.js';
import { buildBenchmarkShadowSeries } from '../../domain/benchmark';
import { seedMiniCsv, waitFor } from '../../../testing/seed';
import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
    beforeEach(async () => {
        const db = new PortfolioDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
        await db.portfolios.add({
            id: 'p1',
            name: 'DEGIRO',
            reportingCurrency: 'EUR',
            createdAt: new Date().toISOString(),
        });
        await TestBed.configureTestingModule({
            imports: [DashboardPage],
            providers: [
                { provide: PortfolioDatabase, useValue: db },
                { provide: MarketDataProvider, useClass: YahooMarketDataProvider },
                provideRouter([]),
            ],
        }).compileComponents();
        await seedMiniCsv(TestBed.inject(ImportService));
    });

    async function createPage(): Promise<DashboardPage> {
        const fixture = TestBed.createComponent(DashboardPage);
        fixture.detectChanges();
        const page = fixture.componentInstance;
        await waitFor(() => !page.isEmpty());
        return page;
    }

    it('shows totals from latest trades without quotes', async () => {
        const page = await createPage();
        await waitFor(() => page.marketData.quotes().length === 0);
        const totals = page.valuation().totals;
        expect(totals.netInvested.toFixed(2)).toBe('50000.00');
        expect(totals.value?.toFixed(2)).toBe('50500.00');
        expect(totals.complete).toBe(true);
        expect(page.valuationStatus()).toBe(
            'Estimated: 2 latest-trade prices · Estimated FX: 1 imported exchange rate',
        );
        expect(page.chartSeries()[0].points.length).toBeGreaterThan(0);
        expect(page.chartSeries()[1].points[0]).toEqual({ time: '2021-01-01', value: 50000 });
    });

    it('calculates value and result with manual EUR quotes', async () => {
        const page = await createPage();
        const quotes = TestBed.inject(QuoteService);
        await quotes.save('US0079031078', new Decimal('120'), 'EUR');
        await quotes.save('USN070592100', new Decimal('600'), 'EUR');
        await TestBed.inject(MarketDataService).reload();

        const totals = page.valuation().totals;
        expect(totals.value?.toFixed(2)).toBe('50750.00');
        expect(totals.result?.toFixed(2)).toBe('750.00');
        expect(totals.resultPct?.toFixed(2)).toBe('1.50');
    });

    it('uses the market value series for chart and TWR as soon as history exists', async () => {
        const page = await createPage();
        const db = TestBed.inject(PortfolioDatabase);
        await db.priceHistory.bulkPut([
            { isin: 'US0079031078', date: '2026-02-13', close: '110', currency: 'USD' },
            { isin: 'US0079031078', date: '2026-02-16', close: '120', currency: 'USD' },
            { isin: 'USN070592100', date: '2026-02-16', close: '600', currency: 'EUR' },
        ]);
        await db.fxCache.put({ pair: 'USD/EUR', date: '2026-02-13', rate: '0.9' });
        await TestBed.inject(MarketDataService).reload();

        expect(page.hasHistory()).toBe(true);
        const values = page.marketSeries().points;
        expect(values.map((p) => p.date)).toEqual(['2026-02-13', '2026-02-16']);
        expect(values[1].value?.toFixed(2)).toBe('50570.00');
        expect(page.chartSeries()[0].points).toEqual([
            { time: '2026-02-13', value: 50180 },
            { time: '2026-02-16', value: 50570 },
        ]);
        expect(page.twr().twrPct?.toFixed(4)).toBe('0.7772');
    });

    it('shows no TWR without price history (fallback points have no flows)', async () => {
        const page = await createPage();
        await waitFor(() => page.marketData.quotes().length === 0);
        expect(page.hasHistory()).toBe(false);
        expect(page.twr().twr).toBeNull();
    });

    it('excludes incomplete fallback values and suppresses authoritative returns and weights', async () => {
        const page = await createPage();
        await TestBed.inject(ImportService).importCsv(
            'p1',
            'unknown-fx.csv',
            [
                'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
                '15-02-2026,10:00,15-02-2026,Mystery,XX0000000001,"SPIN-OFF: Koop 1 @ 10,00 XYZ",,XYZ,"0,00",XYZ,"0,00",eeeeeeee-1111-1111-1111-111111111111',
            ].join('\n'),
        );
        await TestBed.inject(PortfolioContext).refresh();

        const incompleteDates = page
            .valuation()
            .points.filter((point) => !point.complete && point.value !== null)
            .map((point) => point.date);
        expect(incompleteDates).toContain('2026-02-15');
        expect(page.chartSeries()[0].points.every((point) => !incompleteDates.includes(point.time))).toBe(true);
        expect(page.rangeResult()).toBeNull();
        expect(page.xirrPerYear()).toBeNull();
        expect(page.topHoldings().every((holding) => holding.weightPct === null)).toBe(true);
    });

    it('filters the chart by range', async () => {
        const page = await createPage();
        const all = page.chartSeries()[1].points.length;
        page.range.set('1y');
        const filtered = page.chartSeries()[1].points;
        expect(filtered.length).toBeLessThan(all);
        expect(filtered.every((p) => p.time >= '2025-08-10')).toBe(true);
    });

    it('filters the chart by custom period and validates input', async () => {
        const page = await createPage();
        const all = page.chartSeries()[1].points.length;

        page.customVanDraft.set('2026-02-13');
        page.customToDraft.set('2026-02-14');
        expect(page.customGeldig()).toBe(true);
        page.pasCustomToe();

        expect(page.range()).toBe('custom');
        expect(page.customOpen()).toBe(false);
        const label = page.customLabel();
        expect(label).not.toBe('Custom');
        expect(label).toContain('–');
        expect(label).toContain('feb');
        const points = page.chartSeries()[1].points;
        expect(points.length).toBeLessThan(all);
        expect(points.every((p) => p.time >= '2026-02-13' && p.time <= '2026-02-14')).toBe(true);

        page.customVanDraft.set('2026-02-14');
        page.customToDraft.set('2026-02-13');
        expect(page.customGeldig()).toBe(false);
    });

    it('contains the new ranges in the list', async () => {
        const page = await createPage();
        const ids = page.ranges.map((r) => r.id);
        expect(ids).toEqual(['1d', '1w', '1m', 'mtd', 'ytd', '6m', '1y', '3y', 'all']);
    });

    it('filters the chart for the new ranges', async () => {
        const page = await createPage();
        const all = page.chartSeries()[1].points.length;
        const today = new Date();
        const yyyy = today.getUTCFullYear();
        const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(today.getUTCDate()).padStart(2, '0');
        const todayIso = `${yyyy}-${mm}-${dd}`;
        const mod = (n: number): string => {
            const d = new Date(Date.UTC(yyyy, today.getUTCMonth(), today.getUTCDate() - n));
            return d.toISOString().slice(0, 10);
        };
        const expectations: [string, string][] = [
            ['1d', mod(1)],
            ['1w', mod(7)],
            ['1m', new Date(Date.UTC(yyyy, today.getUTCMonth() - 1, today.getUTCDate())).toISOString().slice(0, 10)],
            ['mtd', `${yyyy}-${mm}-01`],
            ['ytd', `${yyyy}-01-01`],
            ['6m', new Date(Date.UTC(yyyy, today.getUTCMonth() - 6, today.getUTCDate())).toISOString().slice(0, 10)],
            ['1y', new Date(Date.UTC(yyyy - 1, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10)],
            ['3y', new Date(Date.UTC(yyyy - 3, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10)],
        ];
        for (const [rangeId, cutoff] of expectations) {
            page.range.set(rangeId as never);
            const points = page.chartSeries()[1].points;
            expect(points.length, `range ${rangeId}`).toBeGreaterThan(0);
            expect(
                points.every((p) => p.time >= cutoff),
                `range ${rangeId} cutoff ${cutoff}`,
            ).toBe(true);
        }
        expect(todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        page.range.set('all');
        expect(page.chartSeries()[1].points.length).toBe(all);
    });

    it('calculates range result as valueDelta minus flowsInRange', async () => {
        const page = await createPage();
        const quotes = TestBed.inject(QuoteService);
        await quotes.save('US0079031078', new Decimal('120'), 'EUR');
        await quotes.save('USN070592100', new Decimal('600'), 'EUR');
        await TestBed.inject(MarketDataService).reload();

        page.range.set('all');
        const all = page.rangeResult();
        expect(all?.result.toFixed(2)).toBe('750.00');
        expect(all?.resultPct.toFixed(2)).toBe('1.50');

        page.range.set('1y');
        const year = page.rangeResult();
        expect(year?.result.toFixed(2)).toBe('750.00');
    });

    it('filters netInvested, income and costs by range', async () => {
        const page = await createPage();
        const recent = new Date();
        recent.setUTCDate(recent.getUTCDate() - 30);
        const recentIso = recent.toISOString().slice(0, 10);
        const old = '2021-06-01';
        const extraCsv = [
            'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
            `${recentIso.split('-').reverse().join('-')},10:00,${recentIso.split('-').reverse().join('-')},,,iDEAL Deposit,,EUR,"200,00",EUR,"200,00",`,
            `${old.split('-').reverse().join('-')},10:00,${old.split('-').reverse().join('-')},VUSA,IE00B3XXRP09,Dividend,,EUR,"50,00",EUR,"50,00",`,
            `${old.split('-').reverse().join('-')},10:00,${old.split('-').reverse().join('-')},,,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-10,00",EUR,"-10,00",`,
        ].join('\n');
        await TestBed.inject(ImportService).importCsv('p1', 'extra.csv', extraCsv);
        await TestBed.inject(PortfolioContext).refresh();

        page.range.set('1y');
        const inRange = page.rangeTotals();
        expect(inRange.netInvested.toFixed(2)).toBe('200.00');
        expect(inRange.income.toFixed(2)).toBe('0.00');
        expect(inRange.costs.toFixed(2)).toBe('0.00');

        page.range.set('all');
        const all = page.rangeTotals();
        expect(all.netInvested.toFixed(2)).toBe('50200.00');
        expect(all.income.toFixed(2)).toBe('50.00');
        expect(all.costs.toFixed(2)).toBe('-10.00');
    });

    it('uses latest-trade fallback for range result without quotes', async () => {
        const page = await createPage();
        await waitFor(() => page.marketData.quotes().length === 0);
        page.range.set('all');
        expect(page.rangeResult()?.result.toFixed(2)).toBe('500.00');
    });

    it('adds a scaled benchmark line and delta when a benchmark is set', async () => {
        const db = TestBed.inject(PortfolioDatabase);
        await db.priceHistory.bulkPut([
            { isin: 'US0079031078', date: '2026-02-12', close: '100', currency: 'USD' },
            { isin: 'US0079031078', date: '2026-02-13', close: '110', currency: 'USD' },
            { isin: 'US0079031078', date: '2026-02-16', close: '120', currency: 'USD' },
            { isin: 'USN070592100', date: '2026-02-16', close: '600', currency: 'EUR' },
            { isin: 'BENCH:VUSA.AS', date: '2026-02-12', close: '95', currency: 'EUR' },
            { isin: 'BENCH:VUSA.AS', date: '2026-02-13', close: '100', currency: 'EUR' },
            { isin: 'BENCH:VUSA.AS', date: '2026-02-14', close: '105', currency: 'EUR' },
            { isin: 'BENCH:VUSA.AS', date: '2026-02-16', close: '110', currency: 'EUR' },
        ]);
        await db.fxCache.put({ pair: 'USD/EUR', date: '2026-02-13', rate: '0.9' });
        await db.settings.put({ key: 'benchmark:p1', value: 'VUSA.AS' });
        const page = await createPage();
        await waitFor(() => page.benchmark.symbol() === 'VUSA.AS');

        // € view adds a shadow line: same external flows invested in the benchmark
        expect(page.chartSeries().map((s) => s.name)).toEqual(['Value', 'Net invested', 'VUSA.AS (same deposits)']);
        expect(page.pctMode()).toBe(false);
        const expectedShadow = buildBenchmarkShadowSeries(
            page.marketSeries().points,
            [
                { date: '2026-02-12', close: new Decimal('95'), currency: 'EUR' },
                { date: '2026-02-13', close: new Decimal('100'), currency: 'EUR' },
                { date: '2026-02-14', close: new Decimal('105'), currency: 'EUR' },
                { date: '2026-02-16', close: new Decimal('110'), currency: 'EUR' },
            ],
            page.marketData.fxResolver(),
            'EUR',
        );
        expect(page.chartSeries()[2].points.map((p) => p.value)).toEqual(
            expectedShadow.points.map((p) => expect.closeTo(p.value.toNumber(), 6)),
        );

        page.chartMode.set('pct');
        expect(page.pctMode()).toBe(true);
        const series = page.chartSeries();
        expect(series.map((s) => s.name)).toEqual(['Portfolio', 'VUSA.AS']);
        // both lines are indexed to 100 at the range start and share the same scale
        expect(series[1].points.map((p) => p.time)).toEqual(['2026-02-12', '2026-02-13', '2026-02-16']);
        expect(series[1].points.map((p) => p.value)).toEqual([100, (100 / 95) * 100, expect.closeTo(115.789, 3)]);
        expect(series[0].points[0].value).toBe(100);
        const complete = page.marketSeries().points.filter((p) => p.complete && p.value !== null);
        const expectedLast = complete[complete.length - 1].value!.div(complete[0].value!).times(100).toNumber();
        expect(series[0].points[series[0].points.length - 1].value).toBeCloseTo(expectedLast, 6);
        expect(page.benchmarkSeries()?.startDate).toBe('2026-02-12');
        expect(page.benchmarkRangePct()?.toFixed(1)).toBe('15.8');
        expect(page.benchmarkDeltaPct()?.toFixed(2)).toBe(
            page
                .twr()
                .twrPct?.minus(page.benchmarkRangePct() ?? 0)
                .toFixed(2),
        );

        // benchmark-only bar dates must not extend the portfolio series
        expect(page.marketSeries().points.map((p) => p.date)).toEqual(['2026-02-12', '2026-02-13', '2026-02-16']);
    });

    it('shows no benchmark line or delta without a benchmark setting', async () => {
        const page = await createPage();
        await waitFor(() => page.marketData.quotes().length === 0);
        expect(page.benchmark.symbol()).toBeNull();
        expect(page.currencySymbol()).toBe('€');
        expect(page.chartSeries().map((s) => s.name)).toEqual(['Value', 'Net invested']);
        expect(page.benchmarkSeries()).toBeNull();
        expect(page.benchmarkDeltaPct()).toBeNull();
    });
});
