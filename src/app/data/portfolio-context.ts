import { computed, inject, Injectable, signal } from '@angular/core';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { fromStored } from './mappers';
import { PortfolioRepository } from './portfolio.repository';
import { StoredPortfolio, StoredTransaction } from './stored-types';

const SELECTIE_SLEUTEL = 'geselecteerdePortefeuille';

@Injectable({ providedIn: 'root' })
export class PortfolioContext {
    private readonly db = inject(PortfolioDatabase);
    private readonly portfolioRepository = inject(PortfolioRepository);

    private readonly portfoliosState = signal<StoredPortfolio[]>([]);
    private readonly storedTransactions = signal<StoredTransaction[]>([]);

    readonly portfolios = this.portfoliosState.asReadonly();
    readonly selectedPortfolioId = signal('');
    readonly selectedPortfolio = computed(
        () => this.portfolios().find((p) => p.id === this.selectedPortfolioId()) ?? null,
    );
    readonly transactions = computed(() => this.storedTransactions().map(fromStored));

    constructor() {
        void this.herstelSelectie();
    }

    async create(naam: string, rapportagevaluta: string): Promise<StoredPortfolio> {
        const portfolio = await this.portfolioRepository.create(naam, rapportagevaluta);
        await this.refresh();
        return portfolio;
    }

    select(id: string): void {
        this.selectedPortfolioId.set(id);
        if (id !== '') {
            void this.db.settings.put({ sleutel: SELECTIE_SLEUTEL, waarde: id });
        }
        void this.refreshTransactions();
    }

    async refresh(): Promise<void> {
        this.portfoliosState.set(await this.portfolioRepository.list());
        await this.refreshTransactions();
    }

    async herstelSelectieUitLijst(): Promise<void> {
        const [opgeslagen, portfolios] = await Promise.all([
            this.db.settings.get(SELECTIE_SLEUTEL),
            this.portfolioRepository.list(),
        ]);
        this.portfoliosState.set(portfolios);
        const gevonden = portfolios.find((p) => p.id === opgeslagen?.waarde);
        if (gevonden !== undefined) {
            this.select(gevonden.id);
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
                      .where('[portfolioId+datum]')
                      .between([portfolioId, Dexie.minKey], [portfolioId, Dexie.maxKey])
                      .toArray(),
        );
    }

    private async herstelSelectie(): Promise<void> {
        await this.herstelSelectieUitLijst();
    }
}
