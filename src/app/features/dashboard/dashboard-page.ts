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
import { buildValuation, rangeTotals } from '../../domain/valuation';
import { formatMoney } from '../../shared/money';
import { MoneyPipe } from '../../shared/money.pipe';
import { NlDatePipe } from '../../shared/nl-date.pipe';
import { NlNumberPipe } from '../../shared/nl-number.pipe';
import { transactionTypeLabel } from '../../shared/transaction-type';
import { InfoTooltipComponent } from '../../shared/ui/info-tooltip';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

type Range = 'all' | 'mtd' | '1y' | '3y' | '6m' | 'ytd' | '1m' | '1w' | '1d';

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
    if (range === 'all') {
        return null;
    }
    const [jaar, maand, dag] = today.split('-').map(Number);
    if (range === 'ytd') {
        return `${jaar}-01-01`;
    }
    if (range === 'mtd') {
        return `${jaar}-${String(maand).padStart(2, '0')}-01`;
    }
    const cfg: Record<Exclude<Range, 'all' | 'mtd' | 'ytd'>, { j: number; m: number; d: number }> = {
        '1d': { j: 0, m: 0, d: 1 },
        '1w': { j: 0, m: 0, d: 7 },
        '1m': { j: 0, m: 1, d: 0 },
        '6m': { j: 0, m: 6, d: 0 },
        '1y': { j: 1, m: 0, d: 0 },
        '3y': { j: 3, m: 0, d: 0 },
    };
    const c = cfg[range];
    const datum = new Date(Date.UTC(jaar - c.j, maand - 1 - c.m, dag - c.d));
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

interface RangeResult {
    readonly result: Decimal;
    readonly resultPct: Decimal;
}

@Component({
    selector: 'app-dashboard-page',
    imports: [RouterLink, MoneyPipe, NlDatePipe, NlNumberPipe, InfoTooltipComponent, ValueChartComponent],
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

    readonly rangeCutoff = computed(() => cutoffFor(this.range(), this.today));

    readonly rangeTotals = computed(() =>
        rangeTotals(this.context.transactions(), this.marketData.fxResolver(), this.rangeCutoff()),
    );

    readonly rangeResult = computed<RangeResult | null>(() => {
        const punten = this.seriesPunten();
        if (punten.length === 0) {
            return null;
        }
        const first = punten[0];
        const last = punten[punten.length - 1];
        if (first.value === null || last.value === null) {
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
                    valueEur === null || totaal === null || totaal.isZero() ? null : valueEur.div(totaal).times(100);
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

    readonly netInvestedTooltip = computed(() =>
        this.range() === 'all'
            ? 'Deposits minus withdrawals.'
            : 'Deposits minus withdrawals within the selected range.',
    );

    readonly resultTooltip = computed(() => {
        const base = 'Result in your reporting currency (EUR) for the selected range.';
        const result = this.rangeResult();
        if (result === null) {
            return base;
        }
        return `${base} ${formatPct(result.resultPct)}% on capital in range.`;
    });

    readonly twrTooltip = computed(
        () => `Time-weighted return over the selected range (${this.range().toUpperCase()}).`,
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
        const base = `${label} in your reporting currency (EUR) for the selected range. Non-EUR amounts are converted using historical FX rates; amounts without a known rate are excluded.`;
        const currencies = [...perCurrency.keys()];
        const hasNonEur = currencies.some((c) => c !== 'EUR');
        if (!hasNonEur && missing === 0) {
            return base;
        }
        const breakdown = [...perCurrency.entries()]
            .map(([cur, val]) => `${cur} ${formatMoney(val, cur)}`)
            .join(' · ');
        const missingNote =
            missing > 0 ? ` · ${missing} flow${missing === 1 ? '' : 's'} skipped (missing FX)` : '';
        return `${base} Per currency: ${breakdown}${missingNote}.`;
    }
}

function formatPct(value: Decimal): string {
    return new Intl.NumberFormat('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value.toNumber());
}
