import { Component, inject, OnInit, signal } from '@angular/core';
import { ImportService } from '../../data/import.service';
import { PortfolioRepository } from '../../data/portfolio.repository';
import { ImportRapport, StoredImportBatch, StoredPortfolio } from '../../data/stored-types';
import { NlNumberPipe } from '../../shared/nl-number.pipe';

@Component({
    selector: 'app-import-page',
    imports: [NlNumberPipe],
    templateUrl: './import-page.html',
})
export class ImportPage implements OnInit {
    private readonly portfolioRepository = inject(PortfolioRepository);
    private readonly importService = inject(ImportService);

    readonly portfolios = signal<StoredPortfolio[]>([]);
    readonly selectedPortfolioId = signal('');
    readonly newPortfolioName = signal('');
    readonly showCreateForm = signal(false);
    readonly busy = signal(false);
    readonly dragActive = signal(false);
    readonly report = signal<ImportRapport | null>(null);
    readonly error = signal<string | null>(null);
    readonly batches = signal<StoredImportBatch[]>([]);

    async ngOnInit(): Promise<void> {
        const list = await this.portfolioRepository.list();
        this.portfolios.set(list);
        if (list.length > 0) {
            this.selectedPortfolioId.set(list[0].id);
            await this.reloadBatches();
        }
    }

    async createPortfolio(): Promise<void> {
        const naam = this.newPortfolioName().trim();
        if (naam === '' || this.busy()) {
            return;
        }
        const portfolio = await this.portfolioRepository.create(naam, 'EUR');
        this.portfolios.update((list) => [...list, portfolio]);
        this.selectedPortfolioId.set(portfolio.id);
        this.newPortfolioName.set('');
        this.showCreateForm.set(false);
        this.report.set(null);
        await this.reloadBatches();
    }

    async onPortfolioChange(id: string): Promise<void> {
        this.selectedPortfolioId.set(id);
        this.report.set(null);
        this.error.set(null);
        await this.reloadBatches();
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
            await this.reloadBatches();
        } catch (fout: unknown) {
            this.error.set(fout instanceof Error ? fout.message : String(fout));
        } finally {
            this.busy.set(false);
        }
    }

    formatDateTime(iso: string): string {
        return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    }

    private async reloadBatches(): Promise<void> {
        const portfolioId = this.selectedPortfolioId();
        this.batches.set(portfolioId === '' ? [] : await this.importService.batchesFor(portfolioId));
    }
}
