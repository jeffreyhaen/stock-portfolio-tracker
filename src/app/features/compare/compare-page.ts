import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import Decimal from 'decimal.js';
import { map } from 'rxjs';
import { CompareHistoryService, StoredCompareHistoryEntry } from '../../data/compare-history.service';
import { DayBarDto, FundamentalsResult, MarketDataProvider, TickerSuggestion } from '../../data/market-data-provider';
import { buildCompareGroups, CompareColumn, CompareGroup } from '../../domain/compare';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { themeColor } from '../../shared/theme-colors';
import { TickerSearchComponent } from '../../shared/ui/ticker-search';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

const HISTORY_DAYS = 365;
/** Cycle order per DESIGN.md: line, compare, benchmark, then the series-4..6 tokens. */
const SERIES_COLOR_VARIABLES = [
    '--color-chart-line',
    '--color-chart-compare',
    '--color-chart-benchmark',
    '--color-chart-series-4',
    '--color-chart-series-5',
    '--color-chart-series-6',
];

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
    imports: [TickerSearchComponent, ValueChartComponent, LocalizedDatePipe, ConfirmDialogComponent],
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
}
