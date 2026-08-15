import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { holdingStats } from '../../domain/holdings';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { QuotePanelComponent } from './quote-panel';

@Component({
    selector: 'app-prices-page',
    imports: [RouterLink, LocalizedDatePipe, QuotePanelComponent],
    templateUrl: './prices-page.html',
})
export class PricesPage {
    private readonly context = inject(PortfolioContext);
    readonly marketData = inject(MarketDataService);

    constructor() {
        void this.marketData.reload();
    }

    readonly isEmpty = computed(() => this.context.transactions().length === 0);

    readonly holdings = computed(() => holdingStats(this.context.transactions()));

    readonly firstDate = computed(() => {
        const txns = this.context.transactions();
        if (txns.length === 0) {
            return new Date().toISOString().slice(0, 10);
        }
        return txns.reduce((min, t) => (t.date < min ? t.date : min), txns[0].date);
    });
}
