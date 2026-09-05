import { inject, Injectable, signal } from '@angular/core';
import { FundamentalsResult, MarketDataProvider, QuoteResult } from './market-data-provider';
import { fromStoredProjectionModel, toStoredProjectionModel } from './mappers';
import { PortfolioDatabase } from './db';
import { StoredProjectionSnapshot } from './stored-types';
import { ProjectionModel } from '../domain/projection';

/** Read model for the projection start screen: one row per symbol touched before. */
export interface ProjectionOverviewRow {
    symbol: string;
    longName: string | null;
    currency: string;
    snapshotCount: number;
    latestSnapshot: StoredProjectionSnapshot | null;
    /** ISO timestamp; the newest of the model's updatedAt and the latest snapshot's createdAt. */
    lastTouched: string;
}

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

    /** Every symbol with a saved projection model and/or snapshots, newest activity first. */
    async listOverview(): Promise<ProjectionOverviewRow[]> {
        const [models, snapshots] = await Promise.all([
            this.db.projectionModels.toArray(),
            this.db.projectionSnapshots.toArray(),
        ]);
        const snapshotsBySymbol = new Map<string, StoredProjectionSnapshot[]>();
        for (const snapshot of snapshots) {
            const list = snapshotsBySymbol.get(snapshot.symbol);
            if (list === undefined) {
                snapshotsBySymbol.set(snapshot.symbol, [snapshot]);
            } else {
                list.push(snapshot);
            }
        }
        const symbols = new Set<string>([...models.map((model) => model.symbol), ...snapshotsBySymbol.keys()]);
        const rows: ProjectionOverviewRow[] = [];
        for (const symbol of symbols) {
            const perSymbol = (snapshotsBySymbol.get(symbol) ?? []).sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt),
            );
            const latestSnapshot = perSymbol[0] ?? null;
            const model = models.find((item) => item.symbol === symbol) ?? null;
            const lastTouched = [latestSnapshot?.createdAt ?? null, model?.updatedAt ?? null]
                .filter((value): value is string => value !== null)
                .sort()
                .at(-1);
            rows.push({
                symbol,
                longName: latestSnapshot?.longName ?? null,
                currency: latestSnapshot?.currency || model?.currency || '',
                snapshotCount: perSymbol.length,
                latestSnapshot,
                lastTouched: lastTouched ?? '',
            });
        }
        return rows.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
    }
}
