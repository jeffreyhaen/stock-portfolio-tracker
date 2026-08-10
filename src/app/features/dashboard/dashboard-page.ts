import { UpperCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { QuoteSyncService } from '../../data/quote-sync.service';
import { PriceBar, buildMarketValueSeries } from '../../domain/market-value';
import { holdingStats } from '../../domain/holdings';
import { timeWeightedReturn } from '../../domain/twr';
import { buildValuation } from '../../domain/valuation';
import { MoneyPipe } from '../../shared/money.pipe';
import { NlDatePipe } from '../../shared/nl-date.pipe';
import { NlNumberPipe } from '../../shared/nl-number.pipe';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';
import { QuotePanelComponent } from './quote-panel';

type Range = 'all' | '3y' | '1y' | 'ytd';

const RANGES: { id: Range; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: '3y', label: '3Y' },
    { id: '1y', label: '1Y' },
    { id: 'ytd', label: 'YTD' },
];

function cutoffFor(range: Range, today: string): string | null {
    if (range === 'all') {
        return null;
    }
    const [jaar, maand, dag] = today.split('-').map(Number);
    if (range === 'ytd') {
        return `${jaar}-01-01`;
    }
    const jaren = range === '3y' ? 3 : 1;
    const datum = new Date(Date.UTC(jaar - jaren, maand - 1, dag));
    return datum.toISOString().slice(0, 10);
}

@Component({
    selector: 'app-dashboard-page',
    imports: [RouterLink, MoneyPipe, NlDatePipe, NlNumberPipe, UpperCasePipe, ValueChartComponent, QuotePanelComponent],
    templateUrl: './dashboard-page.html',
})
export class DashboardPage {
    private readonly context = inject(PortfolioContext);
    private readonly quoteSync = inject(QuoteSyncService);
    readonly marketData = inject(MarketDataService);

    readonly ranges = RANGES;
    readonly range = signal<Range>('all');

    private readonly today = new Date().toISOString().slice(0, 10);

    constructor() {
        void this.marketData.reload();
    }

    readonly isEmpty = computed(() => this.context.transactions().length === 0);

    readonly holdings = computed(() => holdingStats(this.context.transactions()));

    readonly eersteDatum = computed(() => {
        const txns = this.context.transactions();
        if (txns.length === 0) {
            return this.today;
        }
        return txns.reduce((min, t) => (t.date < min ? t.date : min), txns[0].date);
    });

    readonly valuation = computed(() =>
        buildValuation(
            this.context.transactions(),
            this.marketData.quoteMap(),
            this.marketData.fxResolver(),
            this.today,
        ),
    );

    private readonly barsMap = computed<ReadonlyMap<string, PriceBar[]>>(() => {
        const map = new Map<string, PriceBar[]>();
        for (const bar of this.marketData.priceHistory()) {
            const lijst = map.get(bar.isin) ?? [];
            lijst.push({ datum: bar.datum, slotkoers: new Decimal(bar.slotkoers), valuta: bar.valuta });
            map.set(bar.isin, lijst);
        }
        for (const lijst of map.values()) {
            lijst.sort((a, b) => a.datum.localeCompare(b.datum));
        }
        return map;
    });

    readonly heeftHistorie = computed(() => this.marketData.priceHistory().length > 0);

    readonly marketSeries = computed(() =>
        buildMarketValueSeries(
            this.context.transactions(),
            this.barsMap(),
            this.marketData.fxResolver(),
            this.splitsMap(),
        ),
    );

    private readonly splitsMap = computed(() => {
        const map = new Map<string, { datum: string; factor: Decimal }[]>();
        for (const split of this.marketData.splitEvents()) {
            const lijst = map.get(split.isin) ?? [];
            lijst.push({ datum: split.datum, factor: new Decimal(split.factor) });
            map.set(split.isin, lijst);
        }
        return map;
    });

    private readonly seriesPunten = computed(() => {
        const cutoff = cutoffFor(this.range(), this.today);
        if (this.heeftHistorie()) {
            return this.marketSeries().punten.filter((p) => cutoff === null || p.datum >= cutoff);
        }
        return this.valuation()
            .punten.filter((p) => cutoff === null || p.datum >= cutoff)
            .map((p) => ({ ...p, flow: new Decimal(0) }));
    });

    readonly chartSeries = computed<ChartSeries[]>(() => {
        const punten = this.seriesPunten();
        const valuePoints = punten
            .filter((p) => p.value !== null)
            .map((p) => ({ time: p.datum, value: p.value?.toNumber() ?? 0 }));
        return [
            { name: 'Value', color: '#0068f0', dashed: false, fill: true, points: valuePoints },
            {
                name: 'Net invested',
                color: '#94a3b8',
                dashed: true,
                fill: false,
                points: punten.map((p) => ({ time: p.datum, value: p.netInvested.toNumber() })),
            },
        ];
    });

    readonly twr = computed(() => timeWeightedReturn(this.seriesPunten()));

    async refreshQuotes(): Promise<void> {
        await this.quoteSync.refreshAll(this.eersteDatum());
    }
}
