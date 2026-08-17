import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioContext } from './data/portfolio-context';
import { MarketDataSyncService } from './data/market-data-sync.service';
import { ThemePreference, ThemeService } from './shared/theme.service';

@Component({
    selector: 'app-root',
    imports: [RouterOutlet, RouterLink, RouterLinkActive],
    templateUrl: './app.html',
    styleUrl: './app.css',
})
export class App {
    private readonly context = inject(PortfolioContext);
    private readonly marketDataSync = inject(MarketDataSyncService);
    private readonly themeService = inject(ThemeService);

    readonly portfolioId = this.context.selectedPortfolioId;
    readonly portfolioName = computed(() => this.context.selectedPortfolio()?.name ?? '');
    readonly themePreference = this.themeService.preference;

    readonly themeLabels: Record<ThemePreference, string> = {
        system: 'Theme: system default',
        light: 'Theme: light',
        dark: 'Theme: dark',
    };

    toggleTheme(): void {
        this.themeService.toggle();
    }

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
            await this.marketDataSync.refreshAllIfNeeded(fromDate);
        } catch (error) {
            console.error('Automatic quote refresh failed', error);
        }
    }
}

function localToday(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
