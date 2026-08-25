import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortfolioContext } from '../../data/portfolio-context';
import { MarketDataService } from '../../data/market-data.service';
import Decimal from 'decimal.js';
import { buildImportedFxResolver, convertToReportingCurrency } from '../../domain/fx';
import { holdingPeriodDays, holdingStats } from '../../domain/holdings';
import { buildPriceResolver, PriceProvenance, ResolvedPrice } from '../../domain/price-resolution';
import { buildValuation } from '../../domain/valuation';
import { exchangeCode, stripYahooSuffix } from '../../domain/ticker-match';
import { cashflowsPerIsin, cashflowWindowDays, MIN_ANNUALIZED_RETURN_DAYS, xirr } from '../../domain/xirr';
import { MoneyPipe } from '../../shared/money.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { TableSort } from '../../shared/sort';
import { InfoTooltipComponent } from '../../shared/ui/info-tooltip';
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
    readonly value: Decimal | null;
    readonly valuePerShare: Decimal | null;
    readonly pnl: Decimal | null;
    readonly pnlInclRealized: Decimal | null;
    readonly realizedPnl: Decimal | null;
    readonly realizedBasisAssumedZero: boolean;
    readonly pnlPct: Decimal | null;
    readonly pnlPctYear: Decimal | null;
    readonly allocationPct: Decimal | null;
    readonly priceProvenance: PriceProvenance | null;
    readonly priceLabel: string | null;
    readonly marketDataWarning: boolean;
    readonly marketDataWarningText: string | null;
    readonly basisUnavailableText: string | null;
    readonly realizedUnavailableText: string | null;
}

type HoldingFilter = 'open' | 'closed' | 'all';

@Component({
    selector: 'app-holdings-page',
    imports: [RouterLink, MoneyPipe, LocalizedNumberPipe, InfoTooltipComponent, SortThComponent],
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
            value: (h) => h.value,
            valuePerShare: (h) => h.valuePerShare,
            pnl: (h) => (h.open ? h.pnl : h.realizedPnl),
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
    readonly portfolioId = computed(() => this.context.selectedPortfolioId());

    private readonly valuation = computed(() =>
        buildValuation(
            this.context.transactions(),
            this.marketData.quoteMap(),
            this.marketData.fxResolver(),
            this.today,
            this.reportingCurrency(),
        ),
    );

    readonly valuationStatus = computed(() => {
        const valuation = this.valuation();
        const statuses: string[] = [];
        const missing = valuation.missingQuotes.length + valuation.missingFx.length;
        if (missing > 0) {
            statuses.push(`Partial value: ${missing} missing price or FX input${missing === 1 ? '' : 's'}`);
        }
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
        if ([...valuation.priceProvenance.values()].some((source) => source === 'manual')) {
            statuses.push('Includes manual prices');
        }
        return statuses.length === 0 ? null : statuses.join(' · ');
    });

    private readonly allViews = computed<HoldingView[]>(() => {
        const quotes = this.marketData.quoteMap();
        const fx = this.marketData.fxResolver();
        const securities = new Map(this.marketData.securities().map((s) => [s.isin, s]));
        const currency = this.reportingCurrency();
        const today = this.today;
        const txns = this.context.transactions().filter((txn) => txn.date <= today);
        const stats = holdingStats(txns, {
            reportingCurrency: currency,
            fxFallback: fx,
            includeClosed: true,
            strategy: this.context.selectedPortfolio()?.lotStrategy ?? 'fifo',
        });
        const resolvePrice = buildPriceResolver(txns, quotes);
        const importedFx = buildImportedFxResolver(txns, currency);
        const cashflows = cashflowsPerIsin(txns, {
            reportingCurrency: currency,
            fxFallback: (flowCurrency, date) => importedFx(flowCurrency, date) ?? fx(flowCurrency, date),
        });
        const views = stats.map((h): HoldingView => {
            const security = securities.get(h.isin);
            const resolvedPrice = h.open ? resolvePrice(h.isin, today) : null;
            let value: Decimal | null = null;
            let valuePerShare: Decimal | null = null;
            let pnl: Decimal | null = null;
            let pnlPct: Decimal | null = null;
            let pnlInclRealized: Decimal | null = null;
            let marketDataWarningText: string | null = null;
            if (h.open && resolvedPrice !== null) {
                const converted = convertToReportingCurrency(
                    h.quantity.times(resolvedPrice.price),
                    resolvedPrice.currency,
                    today,
                    currency,
                    fx,
                    resolvedPrice.transactionFxRate,
                    importedFx,
                );
                if (converted !== null) {
                    value = converted.amount;
                    valuePerShare = value.div(h.quantity);
                } else {
                    marketDataWarningText = `The ${resolvedPrice.currency}/${currency} exchange rate is missing, so this holding is excluded from totals.`;
                }
                if (resolvedPrice.provenance === 'trade') {
                    marketDataWarningText = `Estimated from the latest trade price (${resolvedPrice.date ?? 'date unknown'}); no market quote is available.${converted === null ? ` The ${resolvedPrice.currency}/${currency} exchange rate is also missing, so this holding is excluded from totals.` : ''}`;
                } else if (resolvedPrice.stale) {
                    marketDataWarningText = `The cached market price from ${resolvedPrice.date ?? 'an unknown date'} may be stale.${converted === null ? ` The ${resolvedPrice.currency}/${currency} exchange rate is also missing, so this holding is excluded from totals.` : ''}`;
                }
                if (converted?.provenance === 'imported') {
                    const warning = `The ${resolvedPrice.currency}/${currency} exchange rate is estimated from an imported transaction.`;
                    marketDataWarningText =
                        marketDataWarningText === null ? warning : `${marketDataWarningText} ${warning}`;
                }
                if (value !== null && h.netInvested !== null) {
                    pnl = value.minus(h.netInvested);
                    pnlPct = h.netInvested.isZero() ? null : pnl.div(h.netInvested).times(100);
                    pnlInclRealized = h.realizedPnl === null ? null : pnl.plus(h.realizedPnl);
                }
            } else if (h.open) {
                marketDataWarningText =
                    'No quote or usable trade price is available, so this holding is excluded from totals.';
            }
            let pnlPctYear: Decimal | null = null;
            const flows = cashflows.get(h.isin) ?? [];
            if (flows !== null && h.accountingComplete) {
                const endingValue = h.open && value !== null ? [{ date: today, amount: value }] : [];
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
                ticker:
                    security?.quoteTicker !== null && security?.quoteTicker !== undefined
                        ? stripYahooSuffix(security.quoteTicker)
                        : null,
                exchange: security?.exchange ? exchangeCode(security.exchange) : null,
                quantity: h.quantity,
                periodDays:
                    h.firstBuyDate === null
                        ? null
                        : holdingPeriodDays(h.firstBuyDate, h.open ? new Date() : new Date(`${h.closedAt}T00:00:00Z`)),
                netInvested: h.netInvested,
                netInvestedPerShare: h.netInvestedPerShare,
                value,
                valuePerShare,
                pnl,
                pnlInclRealized,
                realizedPnl: h.realizedPnl,
                realizedBasisAssumedZero: h.realizedBasisAssumedZero,
                pnlPct: h.open ? pnlPct : closedPct,
                pnlPctYear,
                allocationPct: null,
                priceProvenance: resolvedPrice?.provenance ?? null,
                priceLabel: h.open ? priceLabel(resolvedPrice, value) : null,
                marketDataWarning: marketDataWarningText !== null,
                marketDataWarningText,
                basisUnavailableText: h.basisComplete
                    ? null
                    : 'Cost basis is unavailable because the imported transactions do not establish the full basis, such as a spin-off without broker basis or an oversell.',
                realizedUnavailableText: h.realizedComplete
                    ? null
                    : 'Realized P&L is unavailable because the imported transactions do not support complete lot accounting, such as an unknown corporate-action basis or an oversell.',
            };
        });
        const totalValue = views
            .filter((v) => v.open && v.value !== null)
            .reduce((sum, v) => sum.plus(v.value ?? 0), new Decimal(0));
        const complete = views.every((view) => !view.open || view.value !== null);
        if (complete && !totalValue.isZero()) {
            return views.map((v) =>
                v.open && v.value !== null
                    ? { ...v, allocationPct: v.value.div(totalValue).times(100) }
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

function priceLabel(price: ResolvedPrice | null, value: Decimal | null): string | null {
    if (price === null) return 'Missing price';
    if (value === null) return 'Missing FX';
    if (price.provenance === 'trade') return null;
    if (price.stale) return 'Stale cached price';
    if (price.provenance === 'manual') return 'Manual price';
    if (price.provenance === 'cache') return 'Cached price';
    return null;
}
