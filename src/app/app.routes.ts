import { Routes } from '@angular/router';

const portfolioRoutes: Routes = [
    {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
    },
    {
        path: 'forecast',
        loadComponent: () => import('./features/forecast/forecast-page').then((m) => m.ForecastPage),
    },
    {
        path: 'holdings',
        loadComponent: () => import('./features/holdings/holdings-page').then((m) => m.HoldingsPage),
    },
    {
        path: 'holdings/:isin',
        loadComponent: () => import('./features/holding-detail/holding-detail-page').then((m) => m.HoldingDetailPage),
    },
    {
        path: 'cash',
        loadComponent: () => import('./features/cash/cash-page').then((m) => m.CashPage),
    },
    {
        path: 'transactions',
        loadComponent: () => import('./features/transactions/transactions-page').then((m) => m.TransactionsPage),
    },
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
];

const portfolioRedirectRoutes: Routes = [
    { path: 'dashboard', data: { target: 'dashboard' } },
    { path: 'forecast', data: { target: 'forecast' } },
    { path: 'holdings', data: { target: 'holdings' } },
    { path: 'cash', data: { target: 'cash' } },
    { path: 'transactions', data: { target: 'transactions' } },
].map((route) => ({
    ...route,
    loadComponent: () => import('./features/portfolio/portfolio-redirect').then((m) => m.PortfolioRedirectComponent),
}));

export const routes: Routes = [
    {
        path: 'portfolios',
        loadComponent: () => import('./features/portfolios/portfolios-page').then((m) => m.PortfoliosPage),
    },
    {
        path: 'projection',
        loadComponent: () => import('./features/projection/projection-page').then((m) => m.ProjectionPage),
    },
    {
        path: 'projection/:symbol',
        loadComponent: () => import('./features/projection/projection-page').then((m) => m.ProjectionPage),
    },
    {
        path: 'prices',
        loadComponent: () => import('./features/prices/prices-page').then((m) => m.PricesPage),
    },
    { path: 'import', pathMatch: 'full', redirectTo: 'portfolios' },
    {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
    },
    {
        path: 'portfolio/:portfolioId',
        loadComponent: () => import('./features/portfolio/portfolio-shell').then((m) => m.PortfolioShellComponent),
        children: portfolioRoutes,
    },
    ...portfolioRedirectRoutes,
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
];
