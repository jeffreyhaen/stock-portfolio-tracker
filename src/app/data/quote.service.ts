import { inject, Injectable } from '@angular/core';
import Decimal from 'decimal.js';
import { PortfolioDatabase } from './db';
import { StoredQuote } from './stored-types';

@Injectable({ providedIn: 'root' })
export class QuoteService {
    private readonly db = inject(PortfolioDatabase);

    async list(): Promise<StoredQuote[]> {
        return this.db.quoteCache.toArray();
    }

    async save(isin: string, price: Decimal, currency: string): Promise<void> {
        await this.db.quoteCache.put({
            key: isin,
            price: price.toString(),
            currency,
            timestamp: new Date().toISOString(),
        });
    }

    async remove(isin: string): Promise<void> {
        await this.db.quoteCache.delete(isin);
    }
}
