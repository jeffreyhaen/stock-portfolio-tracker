import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { StoredTransaction } from './stored-types';

@Injectable({ providedIn: 'root' })
export class TransactionRepository {
    private readonly db = inject(PortfolioDatabase);

    async allForPortfolio(portfolioId: string): Promise<StoredTransaction[]> {
        return this.db.transactions
            .where('[portfolioId+date]')
            .between([portfolioId, Dexie.minKey], [portfolioId, Dexie.maxKey])
            .toArray();
    }

    async countForPortfolio(portfolioId: string): Promise<number> {
        return this.db.transactions
            .where('[portfolioId+date]')
            .between([portfolioId, Dexie.minKey], [portfolioId, Dexie.maxKey])
            .count();
    }
}
