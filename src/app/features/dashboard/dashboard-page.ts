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
import { Cashflow, cashflowWindowDays, MIN_ANNUALIZED_RETURN_DAYS, portfolioCashflows, xirr } from '../../domain/xirr';
import { formatMoney } from '../../shared/money';
import { MoneyPipe } from '../../shared/money.pipe';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { transactionTypeLabel } from '../../shared/transaction-type';
import { InfoTooltipComponent } from '../../shared/ui/info-tooltip';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

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
    imports: [RouterLink, MoneyPipe, LocalizedDatePipe, LocalizedNumberPipe, InfoTooltipComponent, ValueChartComponent],
    templateUrl: './dashboard-page.html',
})
export class DashboardPage {
    private readonly context = inject(PortfolioContext);
    readonly marketData = inject(MarketDataService);

    readonly portfolioId = this.context.selectedPortfolioId;

    readonly ranges = RANGES;
    readonly range = signal<Range>('all');

    readonly customOpen = signal(false);
    readonly customVan = signal<string | null>(null);
    readonly customTo = signal<string | null>(null);
    readonly customVanDraft = signal('');
    readonly customToDraft = signal('');
    readonly maxDate = new Date().toISOString().slice(0, 10);

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
            const list = map.get(bar.isin) ?? [];
            list.push({ date: bar.date, close: new Decimal(bar.close), currency: bar.currency });
            map.set(bar.isin, list);
        }
        for (const list of map.values()) {
            list.sort((a, b) => a.date.localeCompare(b.date));
        }
        return map;
    });

    readonly hasHistory = computed(() => this.marketData.priceHistory().length > 0);

    readonly marketSeries = computed(() =>
        buildMarketValueSeries(
            this.context.transactions(),
            this.barsMap(),
            this.marketData.fxResolver(),
            this.splitsMap(),
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

    readonly bounds = computed<{ from: string | null; to: string | null }>(() => {
        if (this.range() === 'custom') {
            return { from: this.customVan(), to: this.customTo() };
        }
        return { from: cutoffFor(this.range(), this.today), to: null };
    });

    readonly rangeTotals = computed(() => {
        const { from, to } = this.bounds();
        return rangeTotals(this.context.transactions(), this.marketData.fxResolver(), from, to);
    });

    readonly rangeResult = computed<RangeResult | null>(() => {
        const points = this.filteredSeriesPoints();
        if (points.length === 0) {
            return null;
        }
        const first = points[0];
        const last = points[points.length - 1];
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
        const points = this.filteredSeriesPoints();
        const valuePoints = points
            .filter((p) => p.value !== null)
            .map((p) => ({ time: p.date, value: p.value?.toNumber() ?? 0 }));
        return [
            { name: 'Value', color: '#0068f0', dashed: false, fill: true, points: valuePoints },
            {
                name: 'Net invested',
                color: '#94a3b8',
                dashed: true,
                fill: false,
                points: points.map((p) => ({ time: p.date, value: p.netInvested.toNumber() })),
            },
        ];
    });

    readonly twr = computed(() => {
        if (!this.hasHistory()) {
            return { twr: null, twrPct: null, days: 0 };
        }
        return timeWeightedReturn(this.filteredSeriesPoints());
    });

    readonly topHoldings = computed<TopHoldingView[]>(() => {
        const quotes = this.marketData.quoteMap();
        const fx = this.marketData.fxResolver();
        const total = this.valuation().totals.value;
        return this.holdings()
            .map((h) => {
                const quote = quotes.get(h.isin);
                let valueEur: Decimal | null = null;
                if (quote !== undefined) {
                    const rate = fx(quote.currency, this.today);
                    valueEur = rate === null ? null : h.quantity.times(quote.price).times(rate);
                }
                const weightPct =
                    valueEur === null || total === null || total.isZero() ? null : valueEur.div(total).times(100);
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
        const base = 'Result in your reporting currency (EUR) for the selected range.';
        const result = this.rangeResult();
        if (result === null) {
            return base;
        }
        return `${base} ${formatPct(result.resultPct)}% on capital in range.`;
    });

    readonly xirrPerYear = computed<{ pct: Decimal; perYear: boolean } | null>(() => {
        const points = this.filteredSeriesPoints().filter((p) => p.value !== null);
        if (points.length === 0) {
            return null;
        }
        const first = points[0];
        const last = points[points.length - 1];
        const windowDays = cashflowWindowDays([
            { date: first.date, amount: new Decimal(0) },
            { date: last.date, amount: new Decimal(0) },
        ]);
        if (windowDays < MIN_ANNUALIZED_RETURN_DAYS) {
            const rr = this.rangeResult();
            return rr === null ? null : { pct: rr.resultPct, perYear: false };
        }
        const { from, to } = this.bounds();
        const txns = this.context
            .transactions()
            .filter((t) => (from === null || t.date >= from) && (to === null || t.date <= to));
        const external = portfolioCashflows(txns, { fxFallback: this.marketData.fxResolver() });
        if (external === null || first.value === null || last.value === null) {
            return null;
        }
        const flows: Cashflow[] = [
            ...(from === null ? [] : [{ date: first.date, amount: first.value.neg() }]),
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
        const base = `${label} in your reporting currency (EUR) for the selected range. Non-EUR amounts are converted using historical FX rates; amounts without a known rate are excluded.`;
        const currencies = [...perCurrency.keys()];
        const hasNonEur = currencies.some((c) => c !== 'EUR');
        if (!hasNonEur && missing === 0) {
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
