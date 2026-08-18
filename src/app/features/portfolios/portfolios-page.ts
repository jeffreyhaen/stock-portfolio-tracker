import { Component, computed, effect, inject, signal } from '@angular/core';
import { ImportService } from '../../data/import.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { MARKET_DATA_SERVICE_UNAVAILABLE_MESSAGE, MarketDataSyncService } from '../../data/market-data-sync.service';
import { ImportReport, StoredImportBatch, StoredPortfolio } from '../../data/stored-types';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { TableSort } from '../../shared/sort';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';
import { SortThComponent } from '../../shared/ui/sort-th';

type BatchSortKey = 'importedAt' | 'file' | 'rows' | 'added' | 'duplicates' | 'unknown';
interface AutoLinkMessage {
    readonly tone: 'info' | 'warning';
    readonly text: string;
}

@Component({
    selector: 'app-portfolios-page',
    imports: [LocalizedNumberPipe, SortThComponent, ConfirmDialogComponent],
    templateUrl: './portfolios-page.html',
})
export class PortfoliosPage {
    private readonly importService = inject(ImportService);
    private readonly marketDataSync = inject(MarketDataSyncService);
    readonly context = inject(PortfolioContext);

    readonly portfolios = this.context.portfolios;
    readonly selectedPortfolioId = this.context.selectedPortfolioId;
    readonly newPortfolioName = signal('');
    readonly showCreateForm = signal(false);
    readonly busy = signal(false);
    readonly importPhase = signal<'importing' | 'linking'>('importing');
    readonly dragActive = signal(false);
    readonly report = signal<ImportReport | null>(null);
    readonly autoLinkResult = signal<AutoLinkMessage | null>(null);
    readonly error = signal<string | null>(null);
    readonly batches = signal<StoredImportBatch[]>([]);

    readonly batchesSort = new TableSort<BatchSortKey, StoredImportBatch>(
        {
            importedAt: (batch) => batch.importedAt,
            file: (batch) => batch.fileName,
            rows: (batch) => batch.rowCount,
            added: (batch) => batch.report.added,
            duplicates: (batch) => batch.report.skippedDuplicates,
            unknown: (batch) => batch.report.unknownTypes,
        },
        'importedAt',
        'desc',
    );

    readonly sortedBatches = computed(() => this.batchesSort.apply(this.batches()));

    readonly pendingDelete = signal<StoredPortfolio | null>(null);
    readonly editingPortfolioId = signal<string | null>(null);
    readonly editingPortfolioName = signal('');
    readonly errorTitle = signal('Import failed');
    private autoLinkGeneration = 0;

    constructor() {
        effect(() => {
            void this.reloadBatches(this.selectedPortfolioId());
        });
    }

    async createPortfolio(): Promise<void> {
        const name = this.newPortfolioName().trim();
        if (name === '' || this.busy()) {
            return;
        }
        const portfolio = await this.context.create(name, 'EUR');
        this.context.select(portfolio.id);
        this.newPortfolioName.set('');
        this.showCreateForm.set(false);
        this.report.set(null);
        this.autoLinkResult.set(null);
        this.error.set(null);
    }

    onPortfolioChange(id: string): void {
        this.autoLinkGeneration++;
        this.context.select(id);
        this.cancelRename();
        this.report.set(null);
        this.autoLinkResult.set(null);
        this.error.set(null);
    }

    startRename(portfolio: StoredPortfolio): void {
        if (this.busy()) {
            return;
        }
        this.editingPortfolioId.set(portfolio.id);
        this.editingPortfolioName.set(portfolio.name);
    }

    cancelRename(): void {
        this.editingPortfolioId.set(null);
        this.editingPortfolioName.set('');
    }

    async renamePortfolio(portfolio: StoredPortfolio): Promise<void> {
        const name = this.editingPortfolioName().trim();
        if (this.busy() || this.editingPortfolioId() !== portfolio.id || name === '') {
            return;
        }
        this.busy.set(true);
        this.error.set(null);
        try {
            await this.context.renamePortfolio(portfolio.id, name);
            this.cancelRename();
        } catch (error: unknown) {
            this.errorTitle.set('Portfolio rename failed');
            this.error.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.busy.set(false);
        }
    }

    async deletePortfolio(portfolio: StoredPortfolio): Promise<void> {
        if (this.busy()) {
            return;
        }
        this.pendingDelete.set(portfolio);
    }

    async confirmDelete(): Promise<void> {
        const portfolio = this.pendingDelete();
        if (portfolio === null || this.busy()) {
            return;
        }
        this.busy.set(true);
        try {
            await this.context.deletePortfolio(portfolio.id);
            if (this.editingPortfolioId() === portfolio.id) {
                this.cancelRename();
            }
            this.report.set(null);
            this.error.set(null);
        } finally {
            this.pendingDelete.set(null);
            this.busy.set(false);
        }
    }

    cancelDelete(): void {
        this.pendingDelete.set(null);
    }

    async onFileInput(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
            await this.importFile(file);
        }
        input.value = '';
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        this.dragActive.set(true);
    }

    onDragLeave(): void {
        this.dragActive.set(false);
    }

    async onDrop(event: DragEvent): Promise<void> {
        event.preventDefault();
        this.dragActive.set(false);
        const file = event.dataTransfer?.files?.[0];
        if (file) {
            await this.importFile(file);
        }
    }

    async importFile(file: File): Promise<void> {
        await this.importCsvText(file.name, await file.text());
    }

    async importCsvText(fileName: string, csvText: string): Promise<void> {
        const portfolioId = this.selectedPortfolioId();
        if (portfolioId === '' || this.busy()) {
            return;
        }
        const generation = ++this.autoLinkGeneration;
        this.busy.set(true);
        this.importPhase.set('importing');
        this.errorTitle.set('Import failed');
        this.error.set(null);
        this.report.set(null);
        this.autoLinkResult.set(null);
        try {
            const report = await this.importService.importCsv(portfolioId, fileName, csvText);
            this.report.set(report);
            await this.context.refresh();
            await this.reloadBatches(portfolioId);
            if (report.newSecurityIsins.length > 0) {
                const fromDate = report.earliestTransactionDate ?? new Date().toISOString().slice(0, 10);
                void this.autoLinkImported(portfolioId, fromDate, generation, report.newSecurityIsins);
            }
        } catch (error: unknown) {
            this.error.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.busy.set(false);
            this.importPhase.set('importing');
        }
    }

    formatDateTime(iso: string): string {
        return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    }

    private async autoLinkImported(
        portfolioId: string,
        fromDate: string,
        generation: number,
        isins: readonly string[],
    ): Promise<void> {
        try {
            const autoLinkReport = await this.marketDataSync.autoLink(fromDate, isins);
            if (!this.isCurrentAutoLink(portfolioId, generation)) {
                return;
            }
            if (autoLinkReport.serviceUnavailable) {
                this.autoLinkResult.set({
                    tone: 'warning',
                    text: `${MARKET_DATA_SERVICE_UNAVAILABLE_MESSAGE} No ticker searches were completed.`,
                });
                return;
            }
            const parts = [`Auto-link completed: ${autoLinkReport.linked.length} linked`];
            if (autoLinkReport.noCandidate.length > 0) {
                parts.push(`${autoLinkReport.noCandidate.length} without a match`);
            }
            this.autoLinkResult.set({ tone: 'info', text: parts.join(', ') });
        } catch (error: unknown) {
            if (!this.isCurrentAutoLink(portfolioId, generation)) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.autoLinkResult.set({ tone: 'warning', text: `Auto-link failed: ${message}` });
        }
    }

    private isCurrentAutoLink(portfolioId: string, generation: number): boolean {
        return this.autoLinkGeneration === generation && this.selectedPortfolioId() === portfolioId;
    }

    private async reloadBatches(portfolioId: string): Promise<void> {
        this.batches.set(portfolioId === '' ? [] : await this.importService.batchesFor(portfolioId));
    }

}
