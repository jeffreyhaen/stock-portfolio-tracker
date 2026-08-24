import { computed, inject, Injectable, signal } from '@angular/core';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { fromStored } from './mappers';
import { PortfolioRepository } from './portfolio.repository';
import { StoredPortfolio, StoredTransaction } from './stored-types';

const SELECTION_KEY = 'selectedPortfolio';

@Injectable({ providedIn: 'root' })
export class PortfolioContext {
    private readonly db = inject(PortfolioDatabase);
    private readonly portfolioRepository = inject(PortfolioRepository);

    private readonly portfoliosState = signal<StoredPortfolio[]>([]);
    private readonly storedTransactions = signal<StoredTransaction[]>([]);

    readonly portfolios = this.portfoliosState.asReadonly();
    readonly selectedPortfolioId = signal('');
    readonly ready: Promise<void>;
    readonly selectedPortfolio = computed(
        () => this.portfolios().find((p) => p.id === this.selectedPortfolioId()) ?? null,
    );
    readonly transactions = computed(() => this.storedTransactions().map(fromStored));

    constructor() {
        this.ready = this.restoreSelection();
    }

    async create(name: string, reportingCurrency: string): Promise<StoredPortfolio> {
        const portfolio = await this.portfolioRepository.create(name, reportingCurrency);
        await this.refresh();
        return portfolio;
    }

    async renamePortfolio(id: string, name: string): Promise<void> {
        await this.portfolioRepository.rename(id, name);
        await this.refresh();
    }

    async updateReportingCurrency(id: string, currency: string): Promise<void> {
        await this.portfolioRepository.updateReportingCurrency(id, currency);
        await this.refresh();
    }

    async deletePortfolio(id: string): Promise<void> {
        await this.portfolioRepository.delete(id);
        const wasSelected = this.selectedPortfolioId() === id;
        if (wasSelected) {
            await this.db.settings.delete(SELECTION_KEY);
        }
        await this.db.settings.delete(`benchmark:${id}`);
        this.portfoliosState.set(await this.portfolioRepository.list());
        if (!wasSelected) {
            return;
        }
        const first = this.portfolios()[0];
        if (first === undefined) {
            this.selectedPortfolioId.set('');
            this.storedTransactions.set([]);
        } else {
            this.select(first.id);
        }
    }

    select(id: string): void {
        this.selectedPortfolioId.set(id);
        if (id !== '') {
            void this.db.settings.put({ key: SELECTION_KEY, value: id });
        }
        void this.refreshTransactions();
    }

    async refresh(): Promise<void> {
        this.portfoliosState.set(await this.portfolioRepository.list());
        await this.refreshTransactions();
    }

    async restoreSelectionFromList(): Promise<void> {
        const [stored, portfolios] = await Promise.all([
            this.db.settings.get(SELECTION_KEY),
            this.portfolioRepository.list(),
        ]);
        this.portfoliosState.set(portfolios);
        const found = portfolios.find((p) => p.id === stored?.value);
        if (found !== undefined) {
            this.select(found.id);
        } else if (portfolios.length > 0) {
            this.select(portfolios[0].id);
        } else {
            this.selectedPortfolioId.set('');
            this.storedTransactions.set([]);
        }
    }

    private async refreshTransactions(): Promise<void> {
        const portfolioId = this.selectedPortfolioId();
        this.storedTransactions.set(
            portfolioId === ''
                ? []
                : await this.db.transactions
                      .where('[portfolioId+date]')
                      .between([portfolioId, Dexie.minKey], [portfolioId, Dexie.maxKey])
                      .toArray(),
        );
    }

    private async restoreSelection(): Promise<void> {
        await this.restoreSelectionFromList();
        await this.refreshTransactions();
    }
}
