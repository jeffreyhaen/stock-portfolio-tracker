import { UpperCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { cashAt } from '../../domain/engine';
import { PriceBar, buildMarketValueSeries } from '../../domain/market-value';
import { holdingStats } from '../../domain/holdings';
import { timeWeightedReturn } from '../../domain/twr';
import { Transaction } from '../../domain/types';
import { buildValuation } from '../../domain/valuation';
import { MoneyPipe } from '../../shared/money.pipe';
import { NlDatePipe } from '../../shared/nl-date.pipe';
import { NlNumberPipe } from '../../shared/nl-number.pipe';
import { transactionTypeLabel } from '../../shared/transaction-type';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

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

interface TopHoldingView {
    readonly isin: string;
    readonly product: string;
    readonly quantity: Decimal;
    readonly valueEur: Decimal | null;
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

@Component({
    selector: 'app-dashboard-page',
    imports: [RouterLink, MoneyPipe, NlDatePipe, NlNumberPipe, UpperCasePipe, ValueChartComponent],
    templateUrl: './dashboard-page.html',
})
export class DashboardPage {
    private readonly context = inject(PortfolioContext);
    readonly marketData = inject(MarketDataService);

    readonly portfolioId = this.context.selectedPortfolioId;

    readonly ranges = RANGES;
    readonly range = signal<Range>('all');

    private readonly today = new Date().toISOString().slice(0, 10);

    constructor() {
        void this.marketData.reload();
    }

    readonly isEmpty = computed(() => this.context.transactions().length === 0);

    readonly holdings = computed(() => holdingStats(this.context.transactions()));

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

    readonly twr = computed(() => {
        if (!this.heeftHistorie()) {
            return { twr: null, twrPct: null, dagen: 0 };
        }
        return timeWeightedReturn(this.seriesPunten());
    });

    readonly topHoldings = computed<TopHoldingView[]>(() => {
        const quotes = this.marketData.quoteMap();
        const fx = this.marketData.fxResolver();
        const totaal = this.valuation().totals.value;
        return this.holdings()
            .map((h) => {
                const quote = quotes.get(h.isin);
                let valueEur: Decimal | null = null;
                if (quote !== undefined) {
                    const rate = fx(quote.valuta, this.today);
                    valueEur = rate === null ? null : h.quantity.times(quote.prijs).times(rate);
                }
                const weightPct =
                    valueEur === null || totaal === null || totaal.isZero()
                        ? null
                        : valueEur.div(totaal).times(100);
                return { isin: h.isin, product: h.product, quantity: h.quantity, valueEur, weightPct };
            })
            .sort((a, b) => {
                if (a.valueEur === null) {
                    return b.valueEur === null ? 0 : 1;
                }
                if (b.valueEur === null) {
                    return -1;
                }
                return b.valueEur.comparedTo(a.valueEur);
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
        [...cashAt(this.context.transactions()).values()]
            .filter((positie) => !positie.amount.isZero())
            .map((positie) => ({ currency: positie.currency, balance: positie.amount }))
            .sort((a, b) => b.balance.comparedTo(a.balance)),
    );
}
