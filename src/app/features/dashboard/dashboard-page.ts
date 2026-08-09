import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { PortfolioContext } from '../../data/portfolio-context';
import { QuoteService } from '../../data/quote.service';
import { StoredQuote } from '../../data/stored-types';
import { holdingStats } from '../../domain/holdings';
import { parseNlNumber } from '../../domain/numbers';
import { buildValuation } from '../../domain/valuation';
import { MoneyPipe } from '../../shared/money.pipe';
import { NlDatePipe } from '../../shared/nl-date.pipe';
import { NlNumberPipe } from '../../shared/nl-number.pipe';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

type Range = 'all' | '3y' | '1y' | 'ytd';

interface PriceRow {
    readonly isin: string;
    readonly product: string;
    readonly quote: StoredQuote | null;
    readonly invoer: string;
    readonly ongeldig: boolean;
}

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
    imports: [RouterLink, MoneyPipe, NlDatePipe, NlNumberPipe, ValueChartComponent],
    templateUrl: './dashboard-page.html',
})
export class DashboardPage {
    private readonly context = inject(PortfolioContext);
    private readonly quoteService = inject(QuoteService);

    readonly ranges = RANGES;
    readonly range = signal<Range>('all');
    readonly quotes = signal<StoredQuote[]>([]);
    readonly edits = signal<Record<string, { invoer: string; ongeldig: boolean }>>({});
    readonly saving = signal(false);

    private readonly today = new Date().toISOString().slice(0, 10);

    constructor() {
        void this.loadQuotes();
    }

    readonly isEmpty = computed(() => this.context.transactions().length === 0);

    private readonly quoteMap = computed<ReadonlyMap<string, Decimal>>(() => {
        const map = new Map<string, Decimal>();
        for (const quote of this.quotes()) {
            if (quote.valuta === 'EUR') {
                map.set(quote.sleutel, new Decimal(quote.prijs));
            }
        }
        return map;
    });

    readonly valuation = computed(() => buildValuation(this.context.transactions(), this.quoteMap(), this.today));

    readonly priceRows = computed<PriceRow[]>(() => {
        const quotes = this.quotes();
        const edits = this.edits();
        return holdingStats(this.context.transactions()).map((h) => {
            const quote = quotes.find((q) => q.sleutel === h.isin) ?? null;
            const edit = edits[h.isin];
            return {
                isin: h.isin,
                product: h.product,
                quote,
                invoer: edit?.invoer ?? (quote === null ? '' : new Decimal(quote.prijs).toString()),
                ongeldig: edit?.ongeldig ?? false,
            };
        });
    });

    readonly chartSeries = computed<ChartSeries[]>(() => {
        const cutoff = cutoffFor(this.range(), this.today);
        const punten = this.valuation().punten.filter((p) => cutoff === null || p.datum >= cutoff);
        const valuePoints = punten
            .filter((p) => p.value !== null)
            .map((p) => ({ time: p.datum, value: p.value?.toNumber() ?? 0 }));
        return [
            {
                name: 'Value',
                color: '#0068f0',
                dashed: false,
                fill: true,
                points: valuePoints,
            },
            {
                name: 'Net invested',
                color: '#94a3b8',
                dashed: true,
                fill: false,
                points: punten.map((p) => ({ time: p.datum, value: p.netInvested.toNumber() })),
            },
        ];
    });

    async loadQuotes(): Promise<void> {
        this.quotes.set(await this.quoteService.list());
    }

    onPriceInput(isin: string, invoer: string): void {
        this.edits.update((edits) => ({ ...edits, [isin]: { invoer, ongeldig: false } }));
    }

    async savePrices(): Promise<void> {
        if (this.saving()) {
            return;
        }
        const edits: Record<string, { invoer: string; ongeldig: boolean }> = {};
        for (const row of this.priceRows()) {
            if (row.invoer.trim() === '') {
                continue;
            }
            try {
                parseNlNumber(row.invoer);
            } catch {
                edits[row.isin] = { invoer: row.invoer, ongeldig: true };
            }
        }
        if (Object.keys(edits).length > 0) {
            this.edits.update((huidig) => ({ ...huidig, ...edits }));
            return;
        }
        this.saving.set(true);
        try {
            for (const row of this.priceRows()) {
                const ingevoerd = row.invoer.trim();
                const prijs = ingevoerd === '' ? null : parseNlNumber(ingevoerd);
                if (prijs === null && row.quote !== null) {
                    await this.quoteService.remove(row.isin);
                } else if (prijs !== null && row.quote?.prijs !== prijs.toString()) {
                    await this.quoteService.save(row.isin, prijs, 'EUR');
                }
            }
            this.edits.set({});
            await this.loadQuotes();
        } finally {
            this.saving.set(false);
        }
    }
}
