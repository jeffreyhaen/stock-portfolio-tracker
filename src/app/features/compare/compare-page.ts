import { Component, computed, inject, signal } from '@angular/core';
import Decimal from 'decimal.js';
import { DayBarDto, FundamentalsResult, MarketDataProvider, TickerSuggestion } from '../../data/market-data-provider';
import { buildCompareGroups, CompareColumn, CompareGroup } from '../../domain/compare';
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

@Component({
    selector: 'app-compare-page',
    imports: [TickerSearchComponent, ValueChartComponent],
    templateUrl: './compare-page.html',
})
export class ComparePage {
    private readonly provider = inject(MarketDataProvider, { optional: true });

    readonly maxSymbols = SERIES_COLOR_VARIABLES.length;

    readonly entries = signal<CompareEntry[]>([]);
    readonly notice = signal<string | null>(null);

    private nextEntryId = 1;

    readonly canAdd = computed(() => this.entries().length < this.maxSymbols);

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
        void this.loadEntry(entry.id, symbol);
    }

    removeSymbol(id: number): void {
        this.entries.update((list) => list.filter((entry) => entry.id !== id));
        this.notice.set(null);
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
