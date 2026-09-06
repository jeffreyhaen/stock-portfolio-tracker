import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import Decimal from 'decimal.js';
import { map } from 'rxjs';
import { CompareHistoryService, StoredCompareHistoryEntry } from '../../data/compare-history.service';
import {
    DayBarDto,
    FundamentalsResult,
    MarketDataProvider,
    SplitEventDto,
    TickerSuggestion,
} from '../../data/market-data-provider';
import { buildCompareGroups, CompareColumn, CompareGroup } from '../../domain/compare';
import { annualizedReturnPct, buildForecastSeries, forecastValidationError } from '../../domain/forecast';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { MoneyPipe } from '../../shared/money.pipe';
import { themeColor } from '../../shared/theme-colors';
import { TickerSearchComponent } from '../../shared/ui/ticker-search';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

const HISTORY_DAYS = 365;
/** Longer window fetched per symbol when the Forecast tab is opened, for a meaningful CAGR prefill column. */
const FORECAST_HISTORY_DAYS = 365 * 5;
/** Analysts look at most one or two years ahead, so the forecast horizon stays short. */
const FORECAST_DEFAULT_YEARS = 2;
const FORECAST_MAX_TAB_YEARS = 3;

/** Cycle order per DESIGN.md: line, compare, benchmark, then the series-4..6 tokens. */
const SERIES_COLOR_VARIABLES = [
    '--color-chart-line',
    '--color-chart-compare',
    '--color-chart-benchmark',
    '--color-chart-series-4',
    '--color-chart-series-5',
    '--color-chart-series-6',
];

type CompareTab = 'fundamentals' | 'forecast';

interface ForecastHistory {
    readonly bars: DayBarDto[];
    readonly splits: SplitEventDto[];
}

export interface CompareForecastRow {
    readonly entry: CompareEntry;
    /** Analyst EPS growth (average of current + next fiscal year), in percent. */
    readonly outlookPct: Decimal | null;
    /** Historical annualized price return over the available history, in percent. */
    readonly cagrPct: Decimal | null;
    readonly draft: string;
    readonly invalid: boolean;
    readonly projectedPrice: Decimal | null;
    readonly totalReturnPct: Decimal | null;
}

export interface CompareEntry {
    readonly id: number;
    readonly symbol: string;
    readonly name: string | null;
    readonly currency: string | null;
    readonly loading: boolean;
    readonly error: string | null;
    readonly fundamentals: FundamentalsResult | null;
    readonly price: string | null;
    readonly bars: DayBarDto[] | null;
    readonly historyError: string | null;
}

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function parseDecimalInput(value: string): Decimal | null {
    if (value.trim() === '') {
        return null;
    }
    try {
        const decimal = new Decimal(value.replace(',', '.'));
        return decimal.isFinite() ? decimal : null;
    } catch {
        return null;
    }
}

/** Analyst EPS growth (average of current + next fiscal year) in percent, or null without estimates. */
function outlookReturnPct(fundamentals: FundamentalsResult | null): Decimal | null {
    const estimates = fundamentals?.estimates;
    const growthRatios = [estimates?.epsGrowthCurrentFy, estimates?.epsGrowthNextFy]
        .map((ratio) => (ratio === null || ratio === undefined ? null : parseDecimalInput(ratio)))
        .filter((ratio): ratio is Decimal => ratio !== null);
    if (growthRatios.length === 0) {
        return null;
    }
    return growthRatios
        .reduce((sum, ratio) => sum.plus(ratio))
        .dividedBy(growthRatios.length)
        .times(100);
}

function parseRouteSymbols(value: string | null): string[] | null {
    if (value === null) {
        return null;
    }
    const symbols: string[] = [];
    for (const part of value.split(',')) {
        const symbol = part.trim().toUpperCase();
        if (symbol !== '' && !symbols.includes(symbol)) {
            symbols.push(symbol);
        }
    }
    return symbols;
}

@Component({
    selector: 'app-compare-page',
    imports: [TickerSearchComponent, ValueChartComponent, LocalizedDatePipe, ConfirmDialogComponent, MoneyPipe],
    templateUrl: './compare-page.html',
})
export class ComparePage {
    private readonly provider = inject(MarketDataProvider, { optional: true });
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly history = inject(CompareHistoryService);

    readonly maxSymbols = SERIES_COLOR_VARIABLES.length;

    readonly entries = signal<CompareEntry[]>([]);
    readonly notice = signal<string | null>(null);
    readonly recentCompares = signal<StoredCompareHistoryEntry[]>([]);

    readonly activeTab = signal<CompareTab>('fundamentals');
    readonly horizonDraft = signal(String(FORECAST_DEFAULT_YEARS));
    readonly maxYears = FORECAST_MAX_TAB_YEARS;
    readonly returnDrafts = signal<Record<string, string>>({});
    private readonly requestedForecastHistory = new Set<string>();
    readonly forecastHistory = signal<ReadonlyMap<string, ForecastHistory>>(new Map());

    /** Comma-separated symbols carried by /compare/:symbols; null on /compare. */
    private readonly routeSymbols = toSignal(
        this.route.paramMap.pipe(map((params) => parseRouteSymbols(params.get('symbols')))),
        { initialValue: null },
    );

    private nextEntryId = 1;

    readonly canAdd = computed(() => this.entries().length < this.maxSymbols);

    constructor() {
        this.recentCompares.set(this.history.list());
        effect(() => {
            const routeSymbols = this.routeSymbols();
            const current = untracked(this.entries).map((entry) => entry.symbol);
            if (routeSymbols === null ? current.length === 0 : this.sameSymbols(routeSymbols, current)) {
                return;
            }
            untracked(() => this.applyRouteSymbols(routeSymbols));
        });
    }

    private sameSymbols(a: readonly string[], b: readonly string[]): boolean {
        return a.length === b.length && a.every((symbol, i) => symbol === b[i]);
    }

    private applyRouteSymbols(symbols: string[] | null): void {
        this.notice.set(null);
        if (symbols === null || symbols.length === 0) {
            this.entries.set([]);
            return;
        }
        const capped = symbols.slice(0, this.maxSymbols);
        this.nextEntryId = capped.length + 1;
        this.entries.set(
            capped.map((symbol, index) => ({
                id: index + 1,
                symbol,
                name: null,
                currency: null,
                loading: true,
                error: null,
                fundamentals: null,
                price: null,
                bars: null,
                historyError: null,
            })),
        );
        for (const entry of untracked(this.entries)) {
            void this.loadEntry(entry.id, entry.symbol);
        }
        this.record(capped);
    }

    readonly columns = computed<CompareColumn[]>(() =>
        this.entries().map((entry) => ({
            symbol: entry.symbol,
            longName: entry.name,
            currency: entry.currency ?? '',
            price: entry.price,
            fundamentals: entry.fundamentals,
        })),
    );

    readonly groups = computed<CompareGroup[]>(() => buildCompareGroups(this.columns()));

    private readonly horizon = computed<number | null>(() => {
        const value = Number(this.horizonDraft());
        return Number.isInteger(value) && value >= 1 && value <= FORECAST_MAX_TAB_YEARS ? value : null;
    });

    readonly horizonError = computed(() =>
        this.horizon() === null
            ? `Horizon must be a whole number between 1 and ${FORECAST_MAX_TAB_YEARS} years.`
            : null,
    );

    readonly forecastRows = computed<CompareForecastRow[]>(() => {
        const drafts = this.returnDrafts();
        const horizon = this.horizon();
        return this.entries().map((entry) => this.buildForecastRow(entry, drafts[entry.symbol] ?? '', horizon));
    });

    readonly forecastChartSeries = computed<ChartSeries[]>(() => {
        const series: ChartSeries[] = [];
        for (const row of this.forecastRows()) {
            if (row.projectedPrice === null || row.entry.price === null) {
                continue;
            }
            const returnPct = parseDecimalInput(row.draft);
            if (returnPct === null) {
                continue;
            }
            const assumptions = {
                principal: new Decimal(row.entry.price),
                annualReturnPct: returnPct,
                monthlyContribution: new Decimal(0),
                years: this.horizon() ?? 1,
            };
            if (forecastValidationError(assumptions) !== null) {
                continue;
            }
            const forecast = buildForecastSeries(assumptions, isoDate(new Date()));
            const base = assumptions.principal;
            series.push({
                name: row.entry.symbol,
                color: themeColor(SERIES_COLOR_VARIABLES[series.length % SERIES_COLOR_VARIABLES.length], '#0068f0'),
                dashed: false,
                fill: false,
                // Indexed to 100 at the current price so lines of different price levels stay comparable.
                points: forecast.points.map((point) => ({
                    time: point.date,
                    value: point.value.dividedBy(base).times(100).toNumber(),
                })),
            });
        }
        return series;
    });

    readonly chartSeries = computed<ChartSeries[]>(() => {
        const series: ChartSeries[] = [];
        for (const entry of this.entries()) {
            const bars = entry.bars ?? [];
            if (bars.length < 2) {
                continue;
            }
            const base = new Decimal(bars[0].close);
            if (!base.isPositive()) {
                continue;
            }
            series.push({
                name: entry.symbol,
                color: themeColor(SERIES_COLOR_VARIABLES[series.length % SERIES_COLOR_VARIABLES.length], '#0068f0'),
                dashed: false,
                fill: false,
                points: bars.map((bar) => ({
                    time: bar.date,
                    value: new Decimal(bar.close).dividedBy(base).times(100).toNumber(),
                })),
            });
        }
        return series;
    });

    addSymbol(suggestion: TickerSuggestion): void {
        const symbol = suggestion.symbol.trim().toUpperCase();
        if (symbol === '') {
            return;
        }
        if (this.entries().some((entry) => entry.symbol === symbol)) {
            this.notice.set(`${symbol} is already in the comparison.`);
            return;
        }
        if (this.entries().length >= this.maxSymbols) {
            this.notice.set(`A comparison holds at most ${this.maxSymbols} symbols.`);
            return;
        }
        this.notice.set(null);
        const entry: CompareEntry = {
            id: this.nextEntryId++,
            symbol,
            name: suggestion.name === symbol ? null : suggestion.name || null,
            currency: null,
            loading: true,
            error: null,
            fundamentals: null,
            price: null,
            bars: null,
            historyError: null,
        };
        this.entries.update((list) => [...list, entry]);
        void this.loadEntry(entry.id, entry.symbol);
        this.record(this.entries().map((item) => item.symbol));
        void this.navigate(this.entries().map((item) => item.symbol));
    }

    removeSymbol(id: number): void {
        const remaining = this.entries()
            .filter((entry) => entry.id !== id)
            .map((entry) => entry.symbol);
        this.entries.update((list) => list.filter((entry) => entry.id !== id));
        this.notice.set(null);
        if (remaining.length > 0) {
            this.record(remaining);
        }
        void this.navigate(remaining);
    }

    openHistoryEntry(entry: StoredCompareHistoryEntry): void {
        void this.navigate(entry.symbols);
    }

    removeHistoryEntry(entry: StoredCompareHistoryEntry): void {
        this.history.remove(entry.symbols);
        this.recentCompares.set(this.history.list());
    }

    readonly clearingHistory = signal(false);

    requestClearHistory(): void {
        this.clearingHistory.set(true);
    }

    cancelClearHistory(): void {
        this.clearingHistory.set(false);
    }

    confirmClearHistory(): void {
        this.history.clear();
        this.recentCompares.set([]);
        this.clearingHistory.set(false);
    }

    private record(symbols: string[]): void {
        this.history.record(symbols);
        this.recentCompares.set(this.history.list());
    }

    private navigate(symbols: string[]): Promise<boolean> {
        return symbols.length === 0
            ? this.router.navigate(['/compare'])
            : this.router.navigate(['/compare', symbols.join(',')]);
    }

    private patchEntry(id: number, patch: Partial<CompareEntry>): void {
        this.entries.update((list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    }

    private async loadEntry(id: number, symbol: string): Promise<void> {
        if (this.provider === null) {
            this.patchEntry(id, { loading: false, error: 'Market data is not available on this origin.' });
            return;
        }
        try {
            const fundamentals = await this.provider.fundamentals(symbol);
            this.prefillReturn(symbol, fundamentals);
            this.patchEntry(id, {
                fundamentals,
                name: fundamentals.longName ?? null,
                currency: fundamentals.currency,
                error: null,
            });
        } catch (error) {
            this.patchEntry(id, { loading: false, error: String((error as Error).message ?? error) });
            return;
        }
        const [quoteResult, historyResult] = await Promise.allSettled([
            this.provider.quote(symbol),
            this.provider.history(symbol, isoDate(new Date(Date.now() - HISTORY_DAYS * 86400000)), isoDate(new Date())),
        ]);
        const price = quoteResult.status === 'fulfilled' ? quoteResult.value.price : null;
        const bars = historyResult.status === 'fulfilled' ? historyResult.value.bars : null;
        const historyError =
            historyResult.status === 'rejected'
                ? String((historyResult.reason as Error).message ?? historyResult.reason)
                : null;
        this.patchEntry(id, { price, bars, historyError, loading: false });
    }

    /** Prefills the expected annual return from analyst EPS growth; never overwrites a user edit. */
    private prefillReturn(symbol: string, fundamentals: FundamentalsResult | null): void {
        if (this.returnDrafts()[symbol] !== undefined) {
            return;
        }
        const estimates = fundamentals?.estimates;
        const growthRatios = [estimates?.epsGrowthCurrentFy, estimates?.epsGrowthNextFy]
            .map((ratio) => (ratio === null || ratio === undefined ? null : parseDecimalInput(ratio)))
            .filter((ratio): ratio is Decimal => ratio !== null);
        const prefill =
            growthRatios.length === 0
                ? ''
                : growthRatios
                      .reduce((sum, ratio) => sum.plus(ratio))
                      .dividedBy(growthRatios.length)
                      .times(100)
                      .toFixed(1);
        this.returnDrafts.update((drafts) => ({ ...drafts, [symbol]: prefill }));
    }

    setReturnDraft(symbol: string, value: string): void {
        this.returnDrafts.update((drafts) => ({ ...drafts, [symbol]: value }));
    }

    setActiveTab(tab: CompareTab): void {
        this.activeTab.set(tab);
        if (tab === 'forecast') {
            void this.loadForecastHistory();
        }
    }

    private async loadForecastHistory(): Promise<void> {
        if (this.provider === null) {
            return;
        }
        const from = isoDate(new Date(Date.now() - FORECAST_HISTORY_DAYS * 86400000));
        const to = isoDate(new Date());
        for (const entry of this.entries()) {
            if (this.requestedForecastHistory.has(entry.symbol)) {
                continue;
            }
            this.requestedForecastHistory.add(entry.symbol);
            try {
                const history = await this.provider.history(entry.symbol, from, to);
                this.forecastHistory.update((map) => {
                    const next = new Map(map);
                    next.set(entry.symbol, { bars: history.bars, splits: history.splits });
                    return next;
                });
            } catch {
                this.forecastHistory.update((map) => {
                    const next = new Map(map);
                    next.set(entry.symbol, { bars: [], splits: [] });
                    return next;
                });
            }
        }
    }

    private buildForecastRow(entry: CompareEntry, draft: string, horizon: number | null): CompareForecastRow {
        const outlookPct = outlookReturnPct(entry.fundamentals);
        const cagrPct = this.entryCagrPct(entry);
        const price = entry.price === null ? null : parseDecimalInput(entry.price);
        const returnPct = parseDecimalInput(draft);
        const invalid = draft.trim() !== '' && (returnPct === null || returnPct.lte(-100) || returnPct.gte(100));
        let projectedPrice: Decimal | null = null;
        let totalReturnPct: Decimal | null = null;
        if (price !== null && returnPct !== null && horizon !== null && !invalid) {
            const assumptions = {
                principal: price,
                annualReturnPct: returnPct,
                monthlyContribution: new Decimal(0),
                years: horizon,
            };
            if (forecastValidationError(assumptions) === null) {
                const forecast = buildForecastSeries(assumptions, isoDate(new Date()));
                projectedPrice = forecast.endValue;
                totalReturnPct = forecast.endValue.dividedBy(price).minus(1).times(100);
            }
        }
        return { entry, outlookPct, cagrPct, draft, invalid, projectedPrice, totalReturnPct };
    }

    /** Formats a percent value with sign; em dash when unavailable. */
    formatPct(value: Decimal | null): string {
        if (value === null) {
            return '–';
        }
        return `${new Intl.NumberFormat('nl-NL', { signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(value.toNumber())}%`;
    }

    private entryCagrPct(entry: CompareEntry): Decimal | null {
        const history = this.forecastHistory().get(entry.symbol);
        const bars = history !== undefined && history.bars.length >= 2 ? history.bars : entry.bars;
        if (bars === null || bars.length < 2) {
            return null;
        }
        let first = new Decimal(bars[0].close);
        if (history !== undefined) {
            for (const split of history.splits) {
                if (split.date > bars[0].date) {
                    first = first.dividedBy(parseDecimalInput(split.factor) ?? new Decimal(1));
                }
            }
        }
        const last = new Decimal(bars[bars.length - 1].close);
        return annualizedReturnPct(first, last, daysBetween(bars[0].date, bars[bars.length - 1].date));
    }
}
