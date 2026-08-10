import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { StoredPortfolio } from './stored-types';

@Injectable({ providedIn: 'root' })
export class PortfolioRepository {
    private readonly db = inject(PortfolioDatabase);

    async list(): Promise<StoredPortfolio[]> {
        const portfolios = await this.db.portfolios.toArray();
        return portfolios.sort((a, b) => a.naam.localeCompare(b.naam));
    }

    async create(naam: string, rapportagevaluta: string): Promise<StoredPortfolio> {
        const portfolio: StoredPortfolio = {
            id: crypto.randomUUID(),
            naam,
            rapportagevaluta,
            aangemaaktOp: new Date().toISOString(),
        };
        await this.db.portfolios.add(portfolio);
        return portfolio;
    }

    async delete(id: string): Promise<void> {
        await this.db.transaction('rw', [this.db.portfolios, this.db.transactions, this.db.importBatches], async () => {
            await this.db.transactions
                .where('[portfolioId+datum]')
                .between([id, Dexie.minKey], [id, Dexie.maxKey])
                .delete();
            await this.db.importBatches.where('portfolioId').equals(id).delete();
            await this.db.portfolios.delete(id);
        });
    }
}
