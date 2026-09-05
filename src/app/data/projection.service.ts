import { inject, Injectable, signal } from '@angular/core';
import { FundamentalsResult, MarketDataProvider, QuoteResult } from './market-data-provider';
import { fromStoredProjectionModel, toStoredProjectionModel } from './mappers';
import { PortfolioDatabase } from './db';
import { StoredProjectionSnapshot } from './stored-types';
import { ProjectionModel } from '../domain/projection';

@Injectable({ providedIn: 'root' })
export class ProjectionService {
    private readonly db = inject(PortfolioDatabase);
    private readonly provider = inject(MarketDataProvider, { optional: true });

    private readonly fundamentalsCache = new Map<string, FundamentalsResult>();
    private readonly quoteCache = new Map<string, QuoteResult>();
    readonly fundamentalsLoading = signal(false);
    readonly fundamentalsError = signal<string | null>(null);

    /** Live fundamentals for the active symbol, or null when unavailable/offline. */
    async loadFundamentals(symbol: string): Promise<FundamentalsResult | null> {
        const key = symbol.trim().toUpperCase();
        if (key === '') {
            return null;
        }
        const cached = this.fundamentalsCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        if (this.provider === null) {
            this.fundamentalsError.set('Market data is not available on this origin.');
            return null;
        }
        this.fundamentalsLoading.set(true);
        this.fundamentalsError.set(null);
        try {
            const result = await this.provider.fundamentals(key);
            this.fundamentalsCache.set(key, result);
            return result;
        } catch (error) {
            this.fundamentalsError.set(String((error as Error).message ?? error));
            return null;
        } finally {
            this.fundamentalsLoading.set(false);
        }
    }

    cachedFundamentals(symbol: string): FundamentalsResult | null {
        return this.fundamentalsCache.get(symbol.trim().toUpperCase()) ?? null;
    }

    /** Latest quote for an arbitrary symbol (used for the projection's current price). */
    async loadQuote(symbol: string): Promise<QuoteResult | null> {
        const key = symbol.trim().toUpperCase();
        if (key === '' || this.provider === null) {
            return null;
        }
        const cached = this.quoteCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        try {
            const result = await this.provider.quote(key);
            this.quoteCache.set(key, result);
            return result;
        } catch {
            return null;
        }
    }

    async loadModel(symbol: string): Promise<ProjectionModel | null> {
        const stored = await this.db.projectionModels.get(symbol.trim().toUpperCase());
        return stored === undefined ? null : fromStoredProjectionModel(stored);
    }

    async saveModel(model: ProjectionModel): Promise<void> {
        await this.db.projectionModels.put(toStoredProjectionModel(model));
    }

    async listSnapshots(symbol: string): Promise<StoredProjectionSnapshot[]> {
        const snapshots = await this.db.projectionSnapshots
            .where('symbol')
            .equals(symbol.trim().toUpperCase())
            .toArray();
        return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async saveSnapshot(
        symbol: string,
        currency: string,
        longName: string | null,
        model: ProjectionModel,
    ): Promise<void> {
        await this.db.projectionSnapshots.add({
            symbol: symbol.trim().toUpperCase(),
            createdAt: new Date().toISOString(),
            currency,
            longName,
            model: toStoredProjectionModel(model),
        });
    }

    async deleteSnapshot(id: number): Promise<void> {
        await this.db.projectionSnapshots.delete(id);
    }
}
