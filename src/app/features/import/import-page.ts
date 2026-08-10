import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportService } from '../../data/import.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { ImportRapport, StoredImportBatch, StoredPortfolio } from '../../data/stored-types';
import { NlNumberPipe } from '../../shared/nl-number.pipe';
import { TableSort } from '../../shared/sort';
import { ConfirmDialogComponent } from '../../shared/ui/confirm-dialog';
import { SortThComponent } from '../../shared/ui/sort-th';

type BatchSortKey = 'importedAt' | 'file' | 'rows' | 'added' | 'duplicates' | 'unknown';

@Component({
    selector: 'app-import-page',
    imports: [RouterLink, NlNumberPipe, SortThComponent, ConfirmDialogComponent],
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
    readonly report = signal<ImportRapport | null>(null);
    readonly error = signal<string | null>(null);
    readonly batches = signal<StoredImportBatch[]>([]);

    readonly batchesSort = new TableSort<BatchSortKey, StoredImportBatch>(
        {
            importedAt: (batch) => batch.geimporteerdOp,
            file: (batch) => batch.bestandsnaam,
            rows: (batch) => batch.aantalRegels,
            added: (batch) => batch.rapport.toegevoegd,
            duplicates: (batch) => batch.rapport.overgeslagenDuplicaten,
            unknown: (batch) => batch.rapport.onbekendeTypen,
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
        const naam = this.newPortfolioName().trim();
        if (naam === '' || this.busy()) {
            return;
        }
        const portfolio = await this.context.create(naam, 'EUR');
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

    async bevestigVerwijderen(): Promise<void> {
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

    annuleerVerwijderen(): void {
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

    async importCsvText(bestandsnaam: string, csvTekst: string): Promise<void> {
        const portfolioId = this.selectedPortfolioId();
        if (portfolioId === '' || this.busy()) {
            return;
        }
        this.busy.set(true);
        this.error.set(null);
        this.report.set(null);
        try {
            const rapport = await this.importService.importCsv(portfolioId, bestandsnaam, csvTekst);
            this.report.set(rapport);
            await this.context.refresh();
            await this.reloadBatches(portfolioId);
        } catch (fout: unknown) {
            this.error.set(fout instanceof Error ? fout.message : String(fout));
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
