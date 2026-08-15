import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortfolioContext } from '../../data/portfolio-context';
import { MarketDataService } from '../../data/market-data.service';
import Decimal from 'decimal.js';
import { holdingPeriodDays, holdingStats } from '../../domain/holdings';
import { exchangeDisplayName } from '../../domain/ticker-match';
import { cashflowsPerIsin, cashflowWindowDays, MIN_ANNUALIZED_RETURN_DAYS, xirr } from '../../domain/xirr';
import { MoneyPipe } from '../../shared/money.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { TableSort } from '../../shared/sort';
import { SortThComponent } from '../../shared/ui/sort-th';

interface HoldingView {
    readonly isin: string;
    readonly product: string;
    readonly open: boolean;
    readonly ticker: string | null;
    readonly exchange: string | null;
    readonly quantity: Decimal;
    readonly periodDays: number | null;
    readonly netInvested: Decimal | null;
    readonly netInvestedPerShare: Decimal | null;
    readonly valueEur: Decimal | null;
    readonly valuePerShareEur: Decimal | null;
    readonly pnlEur: Decimal | null;
    readonly pnlInclRealized: Decimal | null;
    readonly realizedPnl: Decimal | null;
    readonly pnlPct: Decimal | null;
    readonly pnlPctYear: Decimal | null;
    readonly allocationPct: Decimal | null;
}

type HoldingFilter = 'open' | 'closed' | 'all';

@Component({
    selector: 'app-holdings-page',
    imports: [RouterLink, MoneyPipe, LocalizedNumberPipe, SortThComponent],
    templateUrl: './holdings-page.html',
})
export class HoldingsPage {
    private readonly context = inject(PortfolioContext);
    private readonly marketData = inject(MarketDataService);

    private readonly today = new Date().toISOString().slice(0, 10);

    readonly filter = signal<HoldingFilter>('open');

    readonly sort = new TableSort<
        | 'security'
        | 'allocation'
        | 'quantity'
        | 'periodDays'
        | 'netInvested'
        | 'perShare'
        | 'value'
        | 'valuePerShare'
        | 'pnl'
        | 'pnlTotal'
        | 'pnlPct'
        | 'pnlYear',
        HoldingView
    >(
        {
            security: (h) => h.product,
            allocation: (h) => h.allocationPct,
            quantity: (h) => (h.open ? h.quantity : null),
            periodDays: (h) => h.periodDays,
            netInvested: (h) => h.netInvested,
            perShare: (h) => h.netInvestedPerShare,
            value: (h) => h.valueEur,
            valuePerShare: (h) => h.valuePerShareEur,
            pnl: (h) => (h.open ? h.pnlEur : h.realizedPnl),
            pnlTotal: (h) => (h.open ? h.pnlInclRealized : h.realizedPnl),
            pnlPct: (h) => h.pnlPct,
            pnlYear: (h) => h.pnlPctYear,
        },
        'allocation',
        'desc',
    );

    constructor() {
        void this.marketData.reload();
    }

    readonly reportingCurrency = computed(() => this.context.selectedPortfolio()?.reportingCurrency ?? 'EUR');

    private readonly allViews = computed<HoldingView[]>(() => {
        const quotes = this.marketData.quoteMap();
        const fx = this.marketData.fxResolver();
        const securities = new Map(this.marketData.securities().map((s) => [s.isin, s]));
        const currency = this.reportingCurrency();
        const txns = this.context.transactions();
        const today = this.today;
        const stats = holdingStats(txns, { reportingCurrency: currency, fxFallback: fx, includeClosed: true });
        const cashflows = cashflowsPerIsin(txns, { reportingCurrency: currency, fxFallback: fx });
        const views = stats.map((h): HoldingView => {
            const security = securities.get(h.isin);
            const quote = quotes.get(h.isin);
            let valueEur: Decimal | null = null;
            let valuePerShareEur: Decimal | null = null;
            let pnlEur: Decimal | null = null;
            let pnlPct: Decimal | null = null;
            let pnlInclRealized: Decimal | null = null;
            if (h.open && quote !== undefined) {
                const rate = fx(quote.currency, today);
                if (rate !== null) {
                    valueEur = h.quantity.times(quote.price).times(rate);
                    valuePerShareEur = valueEur.div(h.quantity);
                }
                if (valueEur !== null && h.netInvested !== null) {
                    pnlEur = valueEur.minus(h.netInvested);
                    pnlPct = h.netInvested.isZero() ? null : pnlEur.div(h.netInvested).times(100);
                    pnlInclRealized = h.realizedPnl === null ? null : pnlEur.plus(h.realizedPnl);
                }
            }
            let pnlPctYear: Decimal | null = null;
            const flows = cashflows.get(h.isin) ?? [];
            if (flows !== null) {
                const endingValue = h.open && valueEur !== null ? [{ date: today, amount: valueEur }] : [];
                const all = [...flows, ...endingValue];
                const r = xirr(all);
                pnlPctYear = r === null || cashflowWindowDays(all) < MIN_ANNUALIZED_RETURN_DAYS ? null : r.times(100);
            }
            let closedPct: Decimal | null = null;
            if (!h.open && h.realizedPnl !== null && h.grossInvested !== null && !h.grossInvested.isZero()) {
                closedPct = h.realizedPnl.div(h.grossInvested).times(100);
            }
            return {
                isin: h.isin,
                product: h.product,
                open: h.open,
                ticker: security?.quoteTicker ?? null,
                exchange: security?.exchange ? exchangeDisplayName(security.exchange) : null,
                quantity: h.quantity,
                periodDays:
                    h.firstBuyDate === null
                        ? null
                        : holdingPeriodDays(h.firstBuyDate, h.open ? new Date() : new Date(`${h.closedAt}T00:00:00Z`)),
                netInvested: h.netInvested,
                netInvestedPerShare: h.netInvestedPerShare,
                valueEur,
                valuePerShareEur,
                pnlEur,
                pnlInclRealized,
                realizedPnl: h.realizedPnl,
                pnlPct: h.open ? pnlPct : closedPct,
                pnlPctYear,
                allocationPct: null,
            };
        });
        const totalValue = views
            .filter((v) => v.open && v.valueEur !== null)
            .reduce((sum, v) => sum.plus(v.valueEur ?? 0), new Decimal(0));
        if (!totalValue.isZero()) {
            return views.map((v) =>
                v.open && v.valueEur !== null
                    ? { ...v, allocationPct: v.valueEur.div(totalValue).times(100) }
                    : v.open
                      ? v
                      : { ...v, allocationPct: new Decimal(0) },
            );
        }
        return views.map((v) => (v.open ? v : { ...v, allocationPct: new Decimal(0) }));
    });

    readonly openCount = computed(() => this.allViews().filter((v) => v.open).length);
    readonly closedCount = computed(() => this.allViews().filter((v) => !v.open).length);

    readonly filtered = computed<HoldingView[]>(() => {
        const f = this.filter();
        if (f === 'all') {
            return this.allViews();
        }
        return this.allViews().filter((v) => (f === 'open' ? v.open : !v.open));
    });

    readonly holdings = computed(() => this.sort.apply(this.filtered()));

    setFilter(filter: HoldingFilter): void {
        this.filter.set(filter);
    }
}
