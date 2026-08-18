import { Routes } from '@angular/router';

const portfolioRoutes: Routes = [
    {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
    },
    {
        path: 'holdings',
        loadComponent: () => import('./features/holdings/holdings-page').then((m) => m.HoldingsPage),
    },
    {
        path: 'cash',
        loadComponent: () => import('./features/cash/cash-page').then((m) => m.CashPage),
    },
    {
        path: 'transactions',
        loadComponent: () => import('./features/transactions/transactions-page').then((m) => m.TransactionsPage),
    },
    {
        path: 'prices',
        loadComponent: () => import('./features/prices/prices-page').then((m) => m.PricesPage),
    },
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
];

const portfolioRedirectRoutes: Routes = [
    { path: 'dashboard', data: { target: 'dashboard' } },
    { path: 'holdings', data: { target: 'holdings' } },
    { path: 'cash', data: { target: 'cash' } },
    { path: 'transactions', data: { target: 'transactions' } },
    { path: 'prices', data: { target: 'prices' } },
].map((route) => ({
    ...route,
    loadComponent: () => import('./features/portfolio/portfolio-redirect').then((m) => m.PortfolioRedirectComponent),
}));

export const routes: Routes = [
    {
        path: 'portfolios',
        loadComponent: () => import('./features/portfolios/portfolios-page').then((m) => m.PortfoliosPage),
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
