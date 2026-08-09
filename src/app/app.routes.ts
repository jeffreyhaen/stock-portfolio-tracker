import { Routes } from '@angular/router';
import { CashPage } from './features/cash/cash-page';
import { HoldingsPage } from './features/holdings/holdings-page';
import { ImportPage } from './features/import/import-page';
import { TransactionsPage } from './features/transactions/transactions-page';
import { PlaceholderPage } from './shared/ui/placeholder-page';

export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    { path: 'dashboard', component: PlaceholderPage, data: { title: 'Dashboard', milestone: 'M4' } },
    { path: 'holdings', component: HoldingsPage },
    { path: 'cash', component: CashPage },
    { path: 'transactions', component: TransactionsPage },
    { path: 'import', component: ImportPage },
];
