import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioContext } from './data/portfolio-context';
import { MarketDataService } from './data/market-data.service';
import { MarketDataSyncService } from './data/market-data-sync.service';
import { NavDropdownComponent } from './shared/ui/nav-dropdown';
import { ThemePreference, ThemeService } from './shared/theme.service';

@Component({
    selector: 'app-root',
    imports: [RouterOutlet, RouterLink, RouterLinkActive, NavDropdownComponent],
    templateUrl: './app.html',
    styleUrl: './app.css',
})
export class App {
    private readonly context = inject(PortfolioContext);
    private readonly marketData = inject(MarketDataService);
    private readonly marketDataSync = inject(MarketDataSyncService);
    private readonly themeService = inject(ThemeService);
    private readonly router = inject(Router);

    private readonly currentUrl = signal(this.router.url);

    readonly portfolioId = this.context.selectedPortfolioId;
    readonly portfolioName = computed(() => this.context.selectedPortfolio()?.name ?? '');
    readonly onPortfolioPage = computed(() => this.currentUrl().startsWith('/portfolio/'));
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
        this.router.events.subscribe((event) => {
            if (event instanceof NavigationEnd) {
                this.currentUrl.set(event.urlAfterRedirects);
            }
        });
        void this.refreshQuotesOnStartup();
    }

    private async refreshQuotesOnStartup(): Promise<void> {
        try {
            await this.marketData.ready;
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
