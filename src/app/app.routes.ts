import { Routes } from '@angular/router';
import { ImportPage } from './features/import/import-page';
import { PlaceholderPage } from './shared/ui/placeholder-page';

export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    { path: 'dashboard', component: PlaceholderPage, data: { title: 'Dashboard', milestone: 'M4' } },
    { path: 'holdings', component: PlaceholderPage, data: { title: 'Holdings', milestone: 'M3' } },
    { path: 'cash', component: PlaceholderPage, data: { title: 'Cash', milestone: 'M3' } },
    { path: 'transactions', component: PlaceholderPage, data: { title: 'Transactions', milestone: 'M3' } },
    { path: 'import', component: ImportPage },
];
