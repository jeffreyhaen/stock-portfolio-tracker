import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortfolioContext } from '../../data/portfolio-context';
import { MarketDataService } from '../../data/market-data.service';
import Decimal from 'decimal.js';
import { holdingPeriodDays, holdingStats } from '../../domain/holdings';
import { MoneyPipe } from '../../shared/money.pipe';
import { NlNumberPipe } from '../../shared/nl-number.pipe';

interface HoldingView {
    readonly isin: string;
    readonly product: string;
    readonly currency: string;
    readonly quantity: Decimal;
    readonly firstBuyDate: string | null;
    readonly periodDays: number | null;
    readonly netInvested: Decimal;
    readonly netInvestedPerShare: Decimal;
    readonly valueNative: Decimal | null;
    readonly valueEur: Decimal | null;
    readonly pnlNative: Decimal | null;
    readonly pnlPct: Decimal | null;
}

@Component({
    selector: 'app-holdings-page',
    imports: [RouterLink, MoneyPipe, NlNumberPipe],
    templateUrl: './holdings-page.html',
})
export class HoldingsPage {
    private readonly context = inject(PortfolioContext);
    private readonly marketData = inject(MarketDataService);

    private readonly today = new Date().toISOString().slice(0, 10);

    constructor() {
        void this.marketData.reload();
    }

    readonly holdings = computed<HoldingView[]>(() => {
        const quotes = this.marketData.quoteMap();
        const fx = this.marketData.fxResolver();
        const today = this.today;
        return holdingStats(this.context.transactions()).map((h) => {
            const quote = quotes.get(h.isin);
            let valueNative: Decimal | null = null;
            let valueEur: Decimal | null = null;
            let pnlNative: Decimal | null = null;
            let pnlPct: Decimal | null = null;
            if (quote !== undefined) {
                valueNative = h.quantity.times(quote.prijs);
                const rate = fx(quote.valuta, today);
                valueEur = rate === null ? null : valueNative.times(rate);
                pnlNative = valueNative.minus(h.netInvested);
                pnlPct = h.netInvested.isZero() ? null : pnlNative.div(h.netInvested).times(100);
            }
            return {
                isin: h.isin,
                product: h.product,
                currency: h.currency,
                quantity: h.quantity,
                firstBuyDate: h.firstBuyDate,
                periodDays: h.firstBuyDate === null ? null : holdingPeriodDays(h.firstBuyDate),
                netInvested: h.netInvested,
                netInvestedPerShare: h.netInvestedPerShare,
                valueNative,
                valueEur,
                pnlNative,
                pnlPct,
            };
        });
    });
}
