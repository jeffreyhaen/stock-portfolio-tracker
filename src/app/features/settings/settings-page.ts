import { Component, computed, inject, signal } from '@angular/core';
import { BackupService, CURRENT_SCHEMA_VERSION, parseBundle } from '../../data/backup.service';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { BackupBundle, BackupError, BackupImportReport } from '../../data/stored-types';
import { NlDatePipe } from '../../shared/nl-date.pipe';
import { NlNumberPipe } from '../../shared/nl-number.pipe';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';

interface BundlePreview {
    readonly schemaVersion: number;
    readonly appVersion: string;
    readonly exportedAt: string;
    readonly bestandsnaam: string;
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

interface StatusMelding {
    readonly toon: 'success' | 'error' | 'info';
    readonly tekst: string;
}

@Component({
    selector: 'app-settings-page',
    imports: [NlDatePipe, NlNumberPipe, ConfirmDialogComponent],
    templateUrl: './settings-page.html',
})
export class SettingsPage {
    private readonly backupService = inject(BackupService);
    private readonly context = inject(PortfolioContext);
    private readonly marketData = inject(MarketDataService);

    readonly schemaVersion = CURRENT_SCHEMA_VERSION;
    readonly busy = signal(false);
    readonly melding = signal<StatusMelding | null>(null);
    readonly pendingImport = signal<BundlePreview | null>(null);
    readonly pendingFile = signal<File | null>(null);

    readonly transactionCount = computed(() => this.context.transactions().length);

    async exportBackup(): Promise<void> {
        if (this.busy()) {
            return;
        }
        this.busy.set(true);
        this.melding.set(null);
        try {
            const bundle = await this.backupService.export();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = this.bestandsnaam(bundle.exportedAt);
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.melding.set({
                toon: 'success',
                tekst: `Backup geëxporteerd (${bundle.totals.transactions} transacties, ${bundle.totals.portfolios} portefeuille(s)).`,
            });
        } catch (fout: unknown) {
            this.melding.set({ toon: 'error', tekst: this.foutmelding(fout, 'Export mislukt.') });
        } finally {
            this.busy.set(false);
        }
    }

    async onImportInput(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
            await this.voorbereidImport(file);
        }
        input.value = '';
    }

    async voorbereidImport(file: File): Promise<void> {
        if (this.busy()) {
            return;
        }
        this.melding.set(null);
        try {
            const text = await file.text();
            const bundle = parseBundle(text);
            this.pendingFile.set(file);
            this.pendingImport.set(this.preview(bundle, file.name));
        } catch (fout: unknown) {
            this.pendingFile.set(null);
            this.pendingImport.set(null);
            this.melding.set({ toon: 'error', tekst: this.foutmelding(fout, 'Import voorbereiden mislukt.') });
        }
    }

    async bevestigImport(): Promise<void> {
        const file = this.pendingFile();
        const preview = this.pendingImport();
        if (file === null || preview === null || this.busy()) {
            return;
        }
        this.busy.set(true);
        this.melding.set(null);
        try {
            const bundle = parseBundle(await file.text());
            const report: BackupImportReport = await this.backupService.import(bundle);
            await this.context.herstelSelectieUitLijst();
            await this.marketData.reload();
            this.melding.set({
                toon: 'success',
                tekst: `Backup teruggezet: ${report.toegevoegd.transactions} transacties, ${report.toegevoegd.portfolios} portefeuille(s).`,
            });
        } catch (fout: unknown) {
            this.melding.set({ toon: 'error', tekst: this.foutmelding(fout, 'Import mislukt.') });
        } finally {
            this.pendingFile.set(null);
            this.pendingImport.set(null);
            this.busy.set(false);
        }
    }

    annuleerImport(): void {
        this.pendingFile.set(null);
        this.pendingImport.set(null);
    }

    private preview(bundle: BackupBundle, bestandsnaam: string): BundlePreview {
        return {
            schemaVersion: bundle.schemaVersion,
            appVersion: bundle.appVersion,
            exportedAt: bundle.exportedAt,
            bestandsnaam,
            totals: bundle.totals,
        };
    }

    private bestandsnaam(iso: string): string {
        const datum = iso.slice(0, 10);
        return `stock-portfolio-backup-${datum}.json`;
    }

    private foutmelding(fout: unknown, fallback: string): string {
        if (fout instanceof BackupError) {
            return fout.message;
        }
        return fout instanceof Error ? `${fallback} ${fout.message}` : fallback;
    }
}
