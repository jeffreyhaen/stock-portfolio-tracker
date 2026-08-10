import { Routes } from '@angular/router';
import { CashPage } from './features/cash/cash-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { HoldingsPage } from './features/holdings/holdings-page';
import { ImportPage } from './features/import/import-page';
import { SettingsPage } from './features/settings/settings-page';
import { TransactionsPage } from './features/transactions/transactions-page';

export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    { path: 'dashboard', component: DashboardPage },
    { path: 'holdings', component: HoldingsPage },
    { path: 'cash', component: CashPage },
    { path: 'transactions', component: TransactionsPage },
    { path: 'import', component: ImportPage },
    { path: 'settings', component: SettingsPage },
];
