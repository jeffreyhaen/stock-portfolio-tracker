import { Component, effect, inject, signal } from '@angular/core';
import { ImportService } from '../../data/import.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { ImportRapport, StoredImportBatch } from '../../data/stored-types';
import { NlNumberPipe } from '../../shared/nl-number.pipe';

@Component({
    selector: 'app-import-page',
    imports: [NlNumberPipe],
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
