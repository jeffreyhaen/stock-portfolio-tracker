import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { BenchmarkService, benchmarkIsin, isBenchmarkIsin } from '../../data/benchmark.service';
import { TickerSuggestion } from '../../data/market-data-provider';
import { MarketDataService } from '../../data/market-data.service';
import { MarketDataSyncService } from '../../data/market-data-sync.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { buildBenchmarkSeries, buildBenchmarkShadowSeries } from '../../domain/benchmark';
import { cashAt } from '../../domain/engine';
import { buildImportedFxResolver, convertToReportingCurrency } from '../../domain/fx';
import { PriceBar, buildMarketValueSeries } from '../../domain/market-value';
import { holdingStats } from '../../domain/holdings';
import { buildPriceResolver } from '../../domain/price-resolution';
import { buildTwrIndexSeries, timeWeightedReturn } from '../../domain/twr';
import { Transaction } from '../../domain/types';
import { buildValuation, rangeTotals } from '../../domain/valuation';
import { Cashflow, cashflowWindowDays, MIN_ANNUALIZED_RETURN_DAYS, portfolioCashflows, xirr } from '../../domain/xirr';
import { formatMoney } from '../../shared/money';
import { MoneyPipe } from '../../shared/money.pipe';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { transactionTypeLabel } from '../../shared/transaction-type';
import { themeColor } from '../../shared/theme-colors';
import { ThemeService } from '../../shared/theme.service';
import { InfoTooltipComponent } from '../../shared/ui/info-tooltip';
import { TickerSearchComponent } from '../../shared/ui/ticker-search';
import { ChartPoint, ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

type Range = 'all' | 'mtd' | '1y' | '3y' | '6m' | 'ytd' | '1m' | '1w' | '1d' | 'custom';

const RANGES: { id: Range; label: string }[] = [
    { id: '1d', label: '1D' },
    { id: '1w', label: '1W' },
    { id: '1m', label: '1M' },
    { id: 'mtd', label: 'MTD' },
    { id: 'ytd', label: 'YTD' },
    { id: '6m', label: '6M' },
    { id: '1y', label: '1Y' },
    { id: '3y', label: '3Y' },
    { id: 'all', label: 'All' },
];

function cutoffFor(range: Range, today: string): string | null {
    if (range === 'all' || range === 'custom') {
        return null;
    }
    const [year, month, day] = today.split('-').map(Number);
    if (range === 'ytd') {
        return `${year}-01-01`;
    }
    if (range === 'mtd') {
        return `${year}-${String(month).padStart(2, '0')}-01`;
    }
    const cfg: Record<Exclude<Range, 'all' | 'mtd' | 'ytd' | 'custom'>, { j: number; m: number; d: number }> = {
        '1d': { j: 0, m: 0, d: 1 },
        '1w': { j: 0, m: 0, d: 7 },
        '1m': { j: 0, m: 1, d: 0 },
        '6m': { j: 0, m: 6, d: 0 },
        '1y': { j: 1, m: 0, d: 0 },
        '3y': { j: 3, m: 0, d: 0 },
    };
    const c = cfg[range];
    const date = new Date(Date.UTC(year - c.j, month - 1 - c.m, day - c.d));
    return date.toISOString().slice(0, 10);
}

interface TopHoldingView {
    readonly isin: string;
    readonly product: string;
    readonly quantity: Decimal;
    readonly value: Decimal | null;
    readonly weightPct: Decimal | null;
}

interface RecentTransactionView {
    readonly id: string;
    readonly date: string;
    readonly label: string;
    readonly product: string;
    readonly mutation: Decimal | null;
    readonly mutationCurrency: string | null;
}

interface CashBalanceView {
    readonly currency: string;
    readonly balance: Decimal;
}

interface RangeResult {
    readonly result: Decimal;
    readonly resultPct: Decimal;
}

@Component({
    selector: 'app-dashboard-page',
    imports: [
        RouterLink,
        MoneyPipe,
        LocalizedDatePipe,
        LocalizedNumberPipe,
        InfoTooltipComponent,
        ValueChartComponent,
        TickerSearchComponent,
    ],
    templateUrl: './dashboard-page.html',
})
export class DashboardPage {
    private readonly context = inject(PortfolioContext);
    readonly marketData = inject(MarketDataService);
    readonly benchmark = inject(BenchmarkService);
    private readonly marketDataSync = inject(MarketDataSyncService);
    private readonly theme = inject(ThemeService);

    readonly portfolioId = this.context.selectedPortfolioId;

    readonly ranges = RANGES;
    readonly range = signal<Range>('all');

    readonly customOpen = signal(false);
    readonly customVan = signal<string | null>(null);
    readonly customTo = signal<string | null>(null);
    readonly customVanDraft = signal('');
    readonly customToDraft = signal('');
    readonly benchmarkEditing = signal(false);
    readonly benchmarkError = signal<string | null>(null);
    readonly benchmarkSaving = signal(false);

    readonly maxDate = new Date().toISOString().slice(0, 10);

    private readonly today = new Date().toISOString().slice(0, 10);

    readonly reportingCurrency = this.marketData.reportingCurrency;

    readonly currencySymbol = computed(
        () =>
            new Intl.NumberFormat('nl-NL', {
                style: 'currency',
                currency: this.reportingCurrency(),
                currencyDisplay: 'narrowSymbol',
            })
                .formatToParts(0)
                .find((part) => part.type === 'currency')?.value ?? this.reportingCurrency(),
    );

    constructor() {
        void this.marketData.reload();
    }

    readonly isEmpty = computed(() => this.context.transactions().length === 0);

    readonly holdings = computed(() =>
        holdingStats(
            this.context.transactions().filter((txn) => txn.date <= this.today),
            {
                reportingCurrency: this.reportingCurrency(),
                fxFallback: this.marketData.fxResolver(),
            },
        ),
    );

    readonly valuation = computed(() =>
        buildValuation(
            this.context.transactions(),
            this.marketData.quoteMap(),
            this.marketData.fxResolver(),
            this.today,
            this.reportingCurrency(),
        ),
    );

    private readonly portfolioIsins = computed(() => {
        const isins = new Set<string>();
        for (const transaction of this.context.transactions()) {
            if (transaction.isin !== null && !isBenchmarkIsin(transaction.isin)) {
                isins.add(transaction.isin);
            }
        }
        return isins;
    });

    private readonly barsMap = computed<ReadonlyMap<string, PriceBar[]>>(() => {
        const portfolioIsins = this.portfolioIsins();
        const map = new Map<string, PriceBar[]>();
        for (const bar of this.marketData.priceHistory()) {
            if (!portfolioIsins.has(bar.isin)) continue;
            const list = map.get(bar.isin) ?? [];
            list.push({ date: bar.date, close: new Decimal(bar.close), currency: bar.currency });
            map.set(bar.isin, list);
        }
        for (const [isin, quote] of this.marketData.quoteMap()) {
            if (!portfolioIsins.has(isin) || quote.date === undefined) continue;
            const list = map.get(isin) ?? [];
            const current = { date: quote.date, close: quote.price, currency: quote.currency };
            const sameDay = list.findIndex((bar) => bar.date === quote.date);
            if (sameDay === -1) list.push(current);
            else list[sameDay] = current;
            map.set(isin, list);
        }
        for (const list of map.values()) {
            list.sort((a, b) => a.date.localeCompare(b.date));
        }
        return map;
    });

    readonly hasHistory = computed(() => {
        const portfolioIsins = this.portfolioIsins();
        return this.marketData.priceHistory().some((bar) => portfolioIsins.has(bar.isin));
    });

    readonly marketSeries = computed(() =>
        buildMarketValueSeries(
            this.context.transactions(),
            this.barsMap(),
            this.marketData.fxResolver(),
            this.splitsMap(),
            this.reportingCurrency(),
        ),
    );

    private readonly splitsMap = computed(() => {
        const map = new Map<string, { date: string; factor: Decimal }[]>();
        for (const split of this.marketData.splitEvents()) {
            const list = map.get(split.isin) ?? [];
            list.push({ date: split.date, factor: new Decimal(split.factor) });
            map.set(split.isin, list);
        }
        return map;
    });

    private readonly filteredSeriesPoints = computed(() => {
        const { from, to } = this.bounds();
        const within = (date: string) => (from === null || date >= from) && (to === null || date <= to);
        if (this.hasHistory()) {
            return this.marketSeries().points.filter((p) => within(p.date));
        }
        return this.valuation()
            .points.filter((p) => within(p.date))
            .map((p) => ({ ...p, flow: new Decimal(0) }));
    });

    private readonly benchmarkBars = computed<PriceBar[]>(() => {
        const symbol = this.benchmark.symbol();
        if (symbol === null) {
            return [];
        }
        const key = benchmarkIsin(symbol);
        return this.marketData
            .priceHistory()
            .filter((bar) => bar.isin === key)
            .map((bar) => ({ date: bar.date, close: new Decimal(bar.close), currency: bar.currency }));
    });

    readonly benchmarkSeries = computed(() => {
        if (this.benchmark.symbol() === null) {
            return null;
        }
        const dates = (this.hasHistory() ? this.marketSeries().points : this.valuation().points).map((p) => p.date);
        const series = buildBenchmarkSeries(
            this.benchmarkBars(),
            dates,
            this.marketData.fxResolver(),
            this.reportingCurrency(),
        );
        return series.points.length === 0 ? null : series;
    });

    private readonly benchmarkRangePoints = computed(() => {
        const series = this.benchmarkSeries();
        if (series === null) {
            return [];
        }
        const { from, to } = this.bounds();
        return series.points.filter((p) => (from === null || p.date >= from) && (to === null || p.date <= to));
    });

    readonly benchmarkChartPoints = computed<ChartPoint[]>(() => {
        const points = this.benchmarkRangePoints();
        if (points.length === 0) {
            return [];
        }
        const base = points[0].close;
        if (base.lte(0)) {
            return [];
        }
        return points.map((p) => ({ time: p.date, value: p.close.div(base).times(100).toNumber() }));
    });

    readonly benchmarkRangePct = computed<Decimal | null>(() => {
        const points = this.benchmarkRangePoints();
        if (points.length === 0) {
            return null;
        }
        const first = points[0].close;
        if (first.lte(0)) {
            return null;
        }
        return points[points.length - 1].close.div(first).minus(1).times(100);
    });

    readonly benchmarkDeltaPct = computed<Decimal | null>(() => {
        const benchmarkPct = this.benchmarkRangePct();
        const twrPct = this.twr().twrPct;
        if (benchmarkPct === null || twrPct === null) {
            return null;
        }
        return twrPct.minus(benchmarkPct);
    });

    readonly benchmarkTooltip = computed(() => {
        const symbol = this.benchmark.symbol();
        if (symbol === null) {
            return 'Compare your portfolio with a stock, ETF or index fund of your choice.';
        }
        const benchmarkPct = this.benchmarkRangePct();
        const base = `Tracks the price return of ${symbol}. The chart's ${this.currencySymbol()} view adds a shadow line: your portfolio's value at the range start invested in ${symbol}, with the same deposits and withdrawals since. In the % view both lines are indexed to 100 at the start of the selected range.`;
        const caveat = 'Price return only: benchmark dividends and transaction costs are not included.';
        return benchmarkPct === null
            ? `${base} ${caveat}`
            : `${base} ${symbol} over this range: ${formatPct(benchmarkPct)}%. ${caveat}`;
    });

    readonly bounds = computed<{ from: string | null; to: string | null }>(() => {
        if (this.range() === 'custom') {
            return { from: this.customVan(), to: this.customTo() };
        }
        return { from: cutoffFor(this.range(), this.today), to: null };
    });

    readonly rangeTotals = computed(() => {
        const { from, to } = this.bounds();
        return rangeTotals(
            this.context.transactions(),
            this.marketData.fxResolver(),
            from,
            to,
            this.reportingCurrency(),
        );
    });

    readonly rangeResult = computed<RangeResult | null>(() => {
        const points = this.filteredSeriesPoints();
        if (points.length === 0) {
            return null;
        }
        const first = points[0];
        const last = points[points.length - 1];
        if (
            first.value === null ||
            last.value === null ||
            ('complete' in first && first.complete === false) ||
            ('complete' in last && last.complete === false)
        ) {
            return null;
        }
        const netInvestedInRange = last.netInvested.minus(first.netInvested);
        const result = last.value.minus(first.value).minus(netInvestedInRange);
        const denominator = first.value.plus(netInvestedInRange);
        if (denominator.isZero()) {
            return { result, resultPct: new Decimal(0) };
        }
        return { result, resultPct: result.div(denominator).times(100) };
    });

    /**
     * Fictitious benchmark shadow portfolio, anchored at the selected range:
     * the portfolio's value at the first complete point of the range is
     * invested in the benchmark at that day's close, and later external
     * deposits/withdrawals buy/sell units. Both chart lines therefore start
     * at the same point and diverge by performance within the range.
     */
    private readonly benchmarkShadowPoints = computed<ChartPoint[]>(() => {
        const bars = this.benchmarkBars();
        const anchor = this.filteredSeriesPoints().find((p) => p.complete && p.value !== null);
        if (bars.length === 0 || anchor?.value === undefined || anchor.value === null || anchor.value.lte(0)) {
            return [];
        }
        const portfolioPoints = (this.hasHistory() ? this.marketSeries().points : []).filter(
            (p) => p.date >= anchor.date,
        );
        const shadow = buildBenchmarkShadowSeries(
            portfolioPoints,
            bars,
            this.marketData.fxResolver(),
            this.reportingCurrency(),
            anchor.value,
        );
        const { from, to } = this.bounds();
        return shadow.points
            .filter((p) => (from === null || p.date >= from) && (to === null || p.date <= to))
            .map((p) => ({ time: p.date, value: p.value.toNumber() }));
    });

    readonly chartMode = signal<'currency' | 'pct'>('currency');

    /** Indexed portfolio performance (TWR index, 100 = range start) for the % comparison view. */
    private readonly portfolioIndexPoints = computed<ChartPoint[]>(() =>
        buildTwrIndexSeries(this.filteredSeriesPoints().filter((p) => p.complete && p.value !== null)).map((p) => ({
            time: p.date,
            value: p.index.toNumber(),
        })),
    );

    readonly pctMode = computed(
        () =>
            this.chartMode() === 'pct' &&
            this.benchmarkChartPoints().length > 0 &&
            this.portfolioIndexPoints().length >= 2,
    );

    readonly chartSeries = computed<ChartSeries[]>(() => {
        this.theme.theme(); // herbereken kleuren bij themawissel
        const symbol = this.benchmark.symbol();
        if (this.pctMode() && symbol !== null) {
            return [
                {
                    name: 'Portfolio',
                    color: themeColor('--color-chart-line', '#0068f0'),
                    dashed: false,
                    fill: true,
                    points: this.portfolioIndexPoints(),
                },
                {
                    name: symbol,
                    color: themeColor('--color-chart-compare', '#d97706'),
                    dashed: false,
                    fill: false,
                    points: this.benchmarkChartPoints(),
                },
            ];
        }
        const points = this.filteredSeriesPoints();
        const valuePoints = points
            .filter((p) => p.value !== null && p.complete)
            .map((p) => ({ time: p.date, value: p.value?.toNumber() ?? 0 }));
        const series: ChartSeries[] = [
            {
                name: 'Value',
                color: themeColor('--color-chart-line', '#0068f0'),
                dashed: false,
                fill: true,
                points: valuePoints,
            },
            {
                name: 'Net invested',
                color: themeColor('--color-chart-benchmark', '#94a3b8'),
                dashed: true,
                fill: false,
                points: points.map((p) => ({ time: p.date, value: p.netInvested.toNumber() })),
            },
        ];
        const shadow = this.benchmarkShadowPoints();
        if (symbol !== null && shadow.length >= 2) {
            series.push({
                name: `${symbol} (same deposits)`,
                color: themeColor('--color-chart-compare', '#d97706'),
                dashed: false,
                fill: false,
                points: shadow,
            });
        }
        return series;
    });

    readonly twr = computed(() => {
        const points = this.filteredSeriesPoints();
        if (
            !this.hasHistory() ||
            points.some((point) => (!point.complete || point.value === null) && !point.flow.isZero())
        ) {
            return { twr: null, twrPct: null, days: 0 };
        }
        return timeWeightedReturn(points.filter((point) => point.complete && point.value !== null));
    });

    readonly valuationStatus = computed(() => {
        const valuation = this.valuation();
        const statuses: string[] = [];
        const missing = valuation.missingQuotes.length + valuation.missingFx.length;
        if (missing > 0)
            statuses.push(`Partial value: ${missing} missing price or FX input${missing === 1 ? '' : 's'}`);
        if (valuation.estimatedIsins.length > 0) {
            statuses.push(
                `Estimated: ${valuation.estimatedIsins.length} latest-trade price${valuation.estimatedIsins.length === 1 ? '' : 's'}`,
            );
        }
        if (valuation.estimatedFx.length > 0) {
            statuses.push(
                `Estimated FX: ${valuation.estimatedFx.length} imported exchange rate${valuation.estimatedFx.length === 1 ? '' : 's'}`,
            );
        }
        if (valuation.staleIsins.length > 0) {
            statuses.push(
                `Stale: ${valuation.staleIsins.length} cached price${valuation.staleIsins.length === 1 ? '' : 's'}`,
            );
        }
        if (statuses.length === 0 && [...valuation.priceProvenance.values()].some((source) => source === 'cache')) {
            statuses.push('Cached market prices');
        }
        if ([...valuation.priceProvenance.values()].some((source) => source === 'manual')) {
            statuses.push('Includes manual prices');
        }
        return statuses.length === 0 ? null : statuses.join(' · ');
    });

    readonly topHoldings = computed<TopHoldingView[]>(() => {
        const quotes = this.marketData.quoteMap();
        const fx = this.marketData.fxResolver();
        const transactions = this.context.transactions();
        const resolvePrice = buildPriceResolver(transactions, quotes);
        const importedFx = buildImportedFxResolver(transactions, this.reportingCurrency());
        const totals = this.valuation().totals;
        const total = totals.complete ? totals.value : null;
        return this.holdings()
            .map((h) => {
                const price = resolvePrice(h.isin, this.today);
                const converted =
                    price === null
                        ? null
                        : convertToReportingCurrency(
                              h.quantity.times(price.price),
                              price.currency,
                              this.today,
                              this.reportingCurrency(),
                              fx,
                              price.transactionFxRate,
                              importedFx,
                          );
                const value = converted?.amount ?? null;
                const weightPct =
                    value === null || total === null || total.isZero() ? null : value.div(total).times(100);
                return {
                    isin: h.isin,
                    product: h.product,
                    quantity: h.quantity,
                    value,
                    weightPct,
                };
            })
            .sort((a, b) => {
                if (a.value === null) {
                    return b.value === null ? 0 : 1;
                }
                if (b.value === null) {
                    return -1;
                }
                return b.value.comparedTo(a.value);
            })
            .slice(0, 10);
    });

    readonly recentTransactions = computed<RecentTransactionView[]>(() =>
        [...this.context.transactions()]
            .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.rowIndex - a.rowIndex)
            .slice(0, 10)
            .map((txn: Transaction) => ({
                id: txn.id,
                date: txn.date,
                label: transactionTypeLabel(txn.type),
                product: txn.product,
                mutation: txn.mutation,
                mutationCurrency: txn.mutationCurrency,
            })),
    );

    readonly cashBalances = computed<CashBalanceView[]>(() =>
        [...cashAt(this.context.transactions(), this.today).values()]
            .filter((position) => !position.amount.isZero())
            .map((position) => ({ currency: position.currency, balance: position.amount }))
            .sort((a, b) => b.balance.comparedTo(a.balance)),
    );

    readonly netInvestedTooltip = computed(() =>
        this.range() === 'all'
            ? 'Deposits minus withdrawals.'
            : 'Deposits minus withdrawals within the selected range.',
    );

    readonly resultTooltip = computed(() => {
        const base = `Result in your reporting currency (${this.reportingCurrency()}) for the selected range.`;
        const result = this.rangeResult();
        if (result === null) {
            return base;
        }
        return `${base} ${formatPct(result.resultPct)}% on capital in range.`;
    });

    readonly xirrPerYear = computed<{ pct: Decimal; perYear: boolean } | null>(() => {
        const points = this.filteredSeriesPoints();
        if (points.length === 0) return null;
        const first = points[0];
        const last = points[points.length - 1];
        const { from, to } = this.bounds();
        if ((from !== null && (!first.complete || first.value === null)) || !last.complete || last.value === null) {
            return null;
        }
        const windowDays = cashflowWindowDays([
            { date: first.date, amount: new Decimal(0) },
            { date: last.date, amount: new Decimal(0) },
        ]);
        if (windowDays < MIN_ANNUALIZED_RETURN_DAYS) {
            const rr = this.rangeResult();
            return rr === null ? null : { pct: rr.resultPct, perYear: false };
        }
        const txns = this.context
            .transactions()
            .filter((t) => (from === null || t.date >= from) && (to === null || t.date <= to));
        const reportingCurrency = this.reportingCurrency();
        const importedFx = buildImportedFxResolver(txns, reportingCurrency);
        const marketFx = this.marketData.fxResolver();
        const external = portfolioCashflows(txns, {
            reportingCurrency,
            fxFallback: (currency, date) => importedFx(currency, date) ?? marketFx(currency, date),
        });
        if (external === null || (from !== null && first.value === null) || last.value === null) {
            return null;
        }
        const boundaryFlows = external
            .filter((flow) => flow.date === first.date)
            .reduce((sum, flow) => sum.plus(flow.amount), new Decimal(0));
        const openingValue = from === null ? null : first.value;
        const flows: Cashflow[] = [
            ...(openingValue === null ? [] : [{ date: first.date, amount: openingValue.neg().minus(boundaryFlows) }]),
            ...external,
            { date: last.date, amount: last.value },
        ];
        const r = xirr(flows);
        return r === null ? null : { pct: r.times(100), perYear: true };
    });

    readonly customLabel = computed(() => {
        const from = this.customVan();
        const to = this.customTo();
        if (this.range() !== 'custom' || from === null || to === null) {
            return 'Custom';
        }
        return `${formatShortDate(from)} – ${formatShortDate(to)}`;
    });

    readonly customGeldig = computed(() => {
        const from = this.customVanDraft();
        const to = this.customToDraft();
        return from !== '' && to !== '' && from <= to && to <= this.maxDate;
    });

    openCustom(): void {
        const txns = this.context.transactions();
        const first = txns.reduce((min, t) => (t.date < min ? t.date : min), this.maxDate);
        this.customVanDraft.set(this.customVan() ?? first);
        this.customToDraft.set(this.customTo() ?? this.maxDate);
        this.customOpen.set(true);
    }

    pasCustomToe(): void {
        if (!this.customGeldig()) {
            return;
        }
        this.customVan.set(this.customVanDraft());
        this.customTo.set(this.customToDraft());
        this.range.set('custom');
        this.customOpen.set(false);
    }

    openBenchmarkEditor(): void {
        this.benchmarkError.set(null);
        this.benchmarkEditing.set(true);
    }

    closeBenchmarkEditor(): void {
        this.benchmarkEditing.set(false);
        this.benchmarkError.set(null);
    }

    async pickBenchmark(suggestion: TickerSuggestion): Promise<void> {
        this.benchmarkSaving.set(true);
        this.benchmarkError.set(null);
        try {
            await this.benchmark.setBenchmark(suggestion.symbol, suggestion.exchange);
            this.chartMode.set('pct');
            this.closeBenchmarkEditor();
        } catch (error) {
            this.benchmarkError.set(String((error as Error).message ?? error));
        } finally {
            this.benchmarkSaving.set(false);
        }
    }

    async clearBenchmark(): Promise<void> {
        await this.benchmark.clearBenchmark();
        this.chartMode.set('currency');
        this.closeBenchmarkEditor();
    }

    private readonly rangeLabel = computed(() =>
        this.range() === 'custom' ? `custom (${this.customLabel()})` : this.range().toUpperCase(),
    );

    readonly twrTooltip = computed(() => `Time-weighted return over the selected range (${this.rangeLabel()}).`);

    readonly xirrPerYearTooltip = computed(
        () =>
            `Money-weighted return (XIRR) over the selected range (${this.rangeLabel()}): the annualized return based on the timing and size of your deposits and withdrawals. Ranges shorter than a year show the absolute result instead, without annualizing.`,
    );

    readonly incomeTooltip = computed(() =>
        this.flowTooltip(
            'Sum of dividends, dividend tax, capital gain distributions and interest income',
            this.rangeTotals().incomePerCurrency,
            this.rangeTotals().missingFxIncome,
        ),
    );

    readonly costsTooltip = computed(() =>
        this.flowTooltip(
            'Sum of broker, connection, transaction-tax, external fees and interest charges',
            this.rangeTotals().costsPerCurrency,
            this.rangeTotals().missingFxCosts,
        ),
    );

    private flowTooltip(label: string, perCurrency: ReadonlyMap<string, Decimal>, missing: number): string {
        const currency = this.reportingCurrency();
        const base = `${label} in your reporting currency (${currency}) for the selected range. Amounts in other currencies are converted using historical FX rates; amounts without a known rate are excluded.`;
        const currencies = [...perCurrency.keys()];
        const hasOther = currencies.some((c) => c !== currency);
        if (!hasOther && missing === 0) {
            return base;
        }
        const breakdown = [...perCurrency.entries()].map(([cur, val]) => `${cur} ${formatMoney(val, cur)}`).join(' · ');
        const missingNote = missing > 0 ? ` · ${missing} flow${missing === 1 ? '' : 's'} skipped (missing FX)` : '';
        return `${base} Per currency: ${breakdown}${missingNote}.`;
    }
}

function formatShortDate(date: string): string {
    return new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
}

function formatPct(value: Decimal): string {
    return new Intl.NumberFormat('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value.toNumber());
}
