import { effect, inject, Injectable, signal } from '@angular/core';
import { PortfolioDatabase } from './db';
import { MarketDataSyncService } from './market-data-sync.service';
import { PortfolioContext } from './portfolio-context';

export const BENCHMARK_ISIN_PREFIX = 'BENCH:';

export function benchmarkIsin(symbol: string): string {
    return `${BENCHMARK_ISIN_PREFIX}${symbol.toUpperCase()}`;
}

export function isBenchmarkIsin(isin: string): boolean {
    return isin.startsWith(BENCHMARK_ISIN_PREFIX);
}

function settingKey(portfolioId: string): string {
    return `benchmark:${portfolioId}`;
}

@Injectable({ providedIn: 'root' })
export class BenchmarkService {
    private readonly db = inject(PortfolioDatabase);
    private readonly context = inject(PortfolioContext);
    private readonly sync = inject(MarketDataSyncService);

    readonly symbol = signal<string | null>(null);

    constructor() {
        effect(() => {
            const portfolioId = this.context.selectedPortfolioId();
            void this.load(portfolioId);
        });
    }

    async setBenchmark(symbol: string, exchange?: string): Promise<void> {
        const portfolioId = this.context.selectedPortfolioId();
        const normalized = symbol.trim().toUpperCase();
        if (portfolioId === '' || normalized === '') {
            return;
        }
        const key = benchmarkIsin(normalized);
        const existing = await this.db.securities.get(key);
        if (existing === undefined) {
            await this.db.securities.add({
                isin: key,
                name: normalized,
                tradingCurrency: null,
                exchange: exchange ?? null,
                quoteTicker: normalized,
            });
        }
        await this.db.settings.put({ key: settingKey(portfolioId), value: normalized });
        this.symbol.set(normalized);
        const transactions = this.context.transactions();
        const fromDate = transactions.reduce(
            (earliest, transaction) => (transaction.date < earliest ? transaction.date : earliest),
            new Date().toISOString().slice(0, 10),
        );
        await this.sync.refreshSecurity(key, fromDate);
    }

    async clearBenchmark(): Promise<void> {
        const portfolioId = this.context.selectedPortfolioId();
        if (portfolioId === '') {
            return;
        }
        await this.db.settings.delete(settingKey(portfolioId));
        this.symbol.set(null);
    }

    private async load(portfolioId: string): Promise<void> {
        if (portfolioId === '') {
            this.symbol.set(null);
            return;
        }
        const stored = await this.db.settings.get(settingKey(portfolioId));
        this.symbol.set(stored?.value ?? null);
    }
}
