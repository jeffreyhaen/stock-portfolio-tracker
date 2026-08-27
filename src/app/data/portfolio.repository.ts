import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { StoredPortfolio } from './stored-types';

@Injectable({ providedIn: 'root' })
export class PortfolioRepository {
    private readonly db = inject(PortfolioDatabase);

    async list(): Promise<StoredPortfolio[]> {
        const portfolios = await this.db.portfolios.toArray();
        return portfolios.sort((a, b) => a.name.localeCompare(b.name));
    }

    async create(name: string, reportingCurrency: string): Promise<StoredPortfolio> {
        const portfolio: StoredPortfolio = {
            id: crypto.randomUUID(),
            name,
            reportingCurrency,
            lotStrategy: 'lifo',
            createdAt: new Date().toISOString(),
        };
        await this.db.portfolios.add(portfolio);
        return portfolio;
    }

    async rename(id: string, name: string): Promise<void> {
        const trimmedName = name.trim();
        if (trimmedName === '') {
            throw new Error('Portfolio name cannot be empty.');
        }
        const updated = await this.db.portfolios.update(id, { name: trimmedName });
        if (updated === 0) {
            throw new Error('Portfolio not found.');
        }
    }

    async updateReportingCurrency(id: string, currency: string): Promise<void> {
        const updated = await this.db.portfolios.update(id, { reportingCurrency: currency });
        if (updated === 0) {
            throw new Error('Portfolio not found.');
        }
    }

    async updateLotStrategy(id: string, lotStrategy: 'fifo' | 'lifo'): Promise<void> {
        const updated = await this.db.portfolios.update(id, { lotStrategy });
        if (updated === 0) {
            throw new Error('Portfolio not found.');
        }
    }

    async delete(id: string): Promise<void> {
        await this.db.transaction('rw', [this.db.portfolios, this.db.transactions, this.db.importBatches], async () => {
            await this.db.transactions
                .where('[portfolioId+date]')
                .between([id, Dexie.minKey], [id, Dexie.maxKey])
                .delete();
            await this.db.importBatches.where('portfolioId').equals(id).delete();
            await this.db.portfolios.delete(id);
        });
    }
}
