import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportService } from '../../data/import.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { ImportReport, StoredImportBatch, StoredPortfolio } from '../../data/stored-types';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { TableSort } from '../../shared/sort';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';
import { SortThComponent } from '../../shared/ui/sort-th';

type BatchSortKey = 'importedAt' | 'file' | 'rows' | 'added' | 'duplicates' | 'unknown';

@Component({
    selector: 'app-import-page',
    imports: [RouterLink, LocalizedNumberPipe, SortThComponent, ConfirmDialogComponent],
    templateUrl: './import-page.html',
})
export class ImportPage {
    private readonly importService = inject(ImportService);
    readonly context = inject(PortfolioContext);

    readonly portfolios = this.context.portfolios;
    readonly selectedPortfolioId = this.context.selectedPortfolioId;
    readonly newPortfolioName = signal('');
    readonly showCreateForm = signal(false);
    readonly busy = signal(false);
    readonly dragActive = signal(false);
    readonly report = signal<ImportReport | null>(null);
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
        this.error.set(null);
    }

    onPortfolioChange(id: string): void {
        this.context.select(id);
        this.report.set(null);
        this.error.set(null);
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
        this.busy.set(true);
        this.error.set(null);
        this.report.set(null);
        try {
            const report = await this.importService.importCsv(portfolioId, fileName, csvText);
            this.report.set(report);
            await this.context.refresh();
            await this.reloadBatches(portfolioId);
        } catch (error: unknown) {
            this.error.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.busy.set(false);
        }
    }

    formatDateTime(iso: string): string {
        return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    }

    private async reloadBatches(portfolioId: string): Promise<void> {
        this.batches.set(portfolioId === '' ? [] : await this.importService.batchesFor(portfolioId));
    }
}
