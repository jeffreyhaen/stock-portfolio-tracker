import { Component, computed, inject, signal } from '@angular/core';
import { BackupService, CURRENT_SCHEMA_VERSION, parseBundle } from '../../data/backup.service';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { BackupBundle, BackupError, BackupImportReport } from '../../data/stored-types';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';

interface BundlePreview {
    readonly schemaVersion: number;
    readonly appVersion: string;
    readonly exportedAt: string;
    readonly fileName: string;
    readonly totals: BundlePreviewTotal;
}

interface BundlePreviewTotal {
    readonly portfolios: number;
    readonly transactions: number;
    readonly securities: number;
    readonly securityAliases: number;
    readonly importBatches: number;
    readonly quoteCache: number;
    readonly fxCache: number;
    readonly priceHistory: number;
    readonly splitEvents: number;
    readonly settings: number;
}

interface StatusMessage {
    readonly kind: 'success' | 'error' | 'info';
    readonly text: string;
}

@Component({
    selector: 'app-settings-page',
    imports: [LocalizedDatePipe, LocalizedNumberPipe, ConfirmDialogComponent],
    templateUrl: './settings-page.html',
})
export class SettingsPage {
    private readonly backupService = inject(BackupService);
    private readonly context = inject(PortfolioContext);
    private readonly marketData = inject(MarketDataService);

    readonly schemaVersion = CURRENT_SCHEMA_VERSION;
    readonly busy = signal(false);
    readonly message = signal<StatusMessage | null>(null);
    readonly pendingImport = signal<BundlePreview | null>(null);
    readonly pendingFile = signal<File | null>(null);

    readonly transactionCount = computed(() => this.context.transactions().length);

    async exportBackup(): Promise<void> {
        if (this.busy()) {
            return;
        }
        this.busy.set(true);
        this.message.set(null);
        try {
            const bundle = await this.backupService.export();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = this.fileName(bundle.exportedAt);
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.message.set({
                kind: 'success',
                text: `Backup exported (${bundle.totals.transactions} transactions, ${bundle.totals.portfolios} portfolio(s)).`,
            });
        } catch (error: unknown) {
            this.message.set({ kind: 'error', text: this.errorMessage(error, 'Export failed.') });
        } finally {
            this.busy.set(false);
        }
    }

    async onImportInput(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
            await this.prepareImport(file);
        }
        input.value = '';
    }

    async prepareImport(file: File): Promise<void> {
        if (this.busy()) {
            return;
        }
        this.message.set(null);
        try {
            const text = await file.text();
            const bundle = parseBundle(text);
            this.pendingFile.set(file);
            this.pendingImport.set(this.preview(bundle, file.name));
        } catch (error: unknown) {
            this.pendingFile.set(null);
            this.pendingImport.set(null);
            this.message.set({ kind: 'error', text: this.errorMessage(error, 'Preparing import failed.') });
        }
    }

    async confirmImport(): Promise<void> {
        const file = this.pendingFile();
        const preview = this.pendingImport();
        if (file === null || preview === null || this.busy()) {
            return;
        }
        this.busy.set(true);
        this.message.set(null);
        try {
            const bundle = parseBundle(await file.text());
            const report: BackupImportReport = await this.backupService.import(bundle);
            await this.context.restoreSelectionFromList();
            await this.marketData.reload();
            this.message.set({
                kind: 'success',
                text: `Backup restored: ${report.added.transactions} transactions, ${report.added.portfolios} portfolio(s).`,
            });
        } catch (error: unknown) {
            this.message.set({ kind: 'error', text: this.errorMessage(error, 'Import failed.') });
        } finally {
            this.pendingFile.set(null);
            this.pendingImport.set(null);
            this.busy.set(false);
        }
    }

    cancelImport(): void {
        this.pendingFile.set(null);
        this.pendingImport.set(null);
    }

    private preview(bundle: BackupBundle, fileName: string): BundlePreview {
        return {
            schemaVersion: bundle.schemaVersion,
            appVersion: bundle.appVersion,
            exportedAt: bundle.exportedAt,
            fileName,
            totals: bundle.totals,
        };
    }

    private fileName(iso: string): string {
        const date = iso.slice(0, 10);
        return `stock-portfolio-backup-${date}.json`;
    }

    private errorMessage(error: unknown, fallback: string): string {
        if (error instanceof BackupError) {
            return error.message;
        }
        return error instanceof Error ? `${fallback} ${error.message}` : fallback;
    }
}
