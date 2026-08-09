import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortfolioContext } from '../../data/portfolio-context';
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
}

@Component({
    selector: 'app-holdings-page',
    imports: [RouterLink, MoneyPipe, NlNumberPipe],
    templateUrl: './holdings-page.html',
})
export class HoldingsPage {
    private readonly context = inject(PortfolioContext);

    readonly holdings = computed<HoldingView[]>(() =>
        holdingStats(this.context.transactions()).map((h) => ({
            isin: h.isin,
            product: h.product,
            currency: h.currency,
            quantity: h.quantity,
            firstBuyDate: h.firstBuyDate,
            periodDays: h.firstBuyDate === null ? null : holdingPeriodDays(h.firstBuyDate),
            netInvested: h.netInvested,
            netInvestedPerShare: h.netInvestedPerShare,
        })),
    );
}
