import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioContext } from './data/portfolio-context';
import { QuoteSyncService } from './data/quote-sync.service';

@Component({
    selector: 'app-root',
    imports: [RouterOutlet, RouterLink, RouterLinkActive],
    templateUrl: './app.html',
    styleUrl: './app.css',
})
export class App {
    private readonly context = inject(PortfolioContext);
    private readonly quoteSync = inject(QuoteSyncService);

    readonly portfolioId = this.context.selectedPortfolioId;
    readonly portfolioName = computed(() => this.context.selectedPortfolio()?.name ?? '');

    constructor() {
        void this.refreshQuotesOnStartup();
    }

    private async refreshQuotesOnStartup(): Promise<void> {
        try {
            await this.context.ready;
            const transactions = this.context.transactions();
            const fromDate =
                transactions.length === 0
                    ? localToday()
                    : transactions.reduce(
                          (earliest, transaction) => (transaction.date < earliest ? transaction.date : earliest),
                          transactions[0].date,
                      );
            await this.quoteSync.refreshAllIfNeeded(fromDate);
        } catch (error) {
            console.error('Automatic quote refresh failed', error);
        }
    }
}

function localToday(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
