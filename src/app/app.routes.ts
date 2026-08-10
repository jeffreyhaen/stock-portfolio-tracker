import { Routes } from '@angular/router';
import { CashPage } from './features/cash/cash-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { HoldingsPage } from './features/holdings/holdings-page';
import { ImportPage } from './features/import/import-page';
import { PortfolioRedirectComponent } from './features/portfolio/portfolio-redirect';
import { PortfolioShellComponent } from './features/portfolio/portfolio-shell';
import { PricesPage } from './features/prices/prices-page';
import { TransactionsPage } from './features/transactions/transactions-page';

const portfolioRoutes: Routes = [
    { path: 'dashboard', component: DashboardPage },
    { path: 'holdings', component: HoldingsPage },
    { path: 'cash', component: CashPage },
    { path: 'transactions', component: TransactionsPage },
    { path: 'prices', component: PricesPage },
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
];

export const routes: Routes = [
    { path: 'import', component: ImportPage },
    { path: 'portfolio/:portfolioId', component: PortfolioShellComponent, children: portfolioRoutes },
    { path: 'dashboard', component: PortfolioRedirectComponent, data: { target: 'dashboard' } },
    { path: 'holdings', component: PortfolioRedirectComponent, data: { target: 'holdings' } },
    { path: 'cash', component: PortfolioRedirectComponent, data: { target: 'cash' } },
    { path: 'transactions', component: PortfolioRedirectComponent, data: { target: 'transactions' } },
    { path: 'prices', component: PortfolioRedirectComponent, data: { target: 'prices' } },
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
];
