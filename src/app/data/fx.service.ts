import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { StoredFxRate } from './stored-types';

const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';
const CHUNK_DAYS = 370;

@Injectable({ providedIn: 'root' })
export class FxService {
    private readonly db = inject(PortfolioDatabase);

    async list(): Promise<StoredFxRate[]> {
        return this.db.fxCache.toArray();
    }

    async latestDate(pair: string): Promise<string | null> {
        const latest = await this.db.fxCache
            .where('[pair+date]')
            .between([pair, Dexie.minKey], [pair, Dexie.maxKey])
            .last();
        return latest?.date ?? null;
    }

    async ensureRange(pair: string, from: string, to: string): Promise<void> {
        const [baseCurrency, quoteCurrency] = pair.split('/');
        let cursor = from;
        while (cursor <= to) {
            const chunkEnd = minDate(addDays(cursor, CHUNK_DAYS), to);
            await this.fetchRange(pair, baseCurrency, quoteCurrency, cursor, chunkEnd);
            cursor = addDays(chunkEnd, 1);
        }
    }

    private async fetchRange(
        pair: string,
        baseCurrency: string,
        quoteCurrency: string,
        from: string,
        to: string,
    ): Promise<void> {
        const existing = await this.db.fxCache.where('[pair+date]').between([pair, from], [pair, to]).count();
        if (existing > 0) {
            const cutoff = addDays(today(), -4);
            const historicalComplete = to < cutoff;
            const latest = await this.db.fxCache.where('[pair+date]').between([pair, from], [pair, to]).last();
            if (historicalComplete || (latest !== undefined && latest.date >= cutoff)) {
                return;
            }
        }
        const response = await fetch(
            `${FRANKFURTER_BASE}/${from}..${to}?base=${baseCurrency}&symbols=${quoteCurrency}`,
            {
                signal: AbortSignal.timeout(20000),
            },
        );
        if (!response.ok) {
            throw new Error(`Frankfurter ${response.status} for ${pair} ${from}..${to}`);
        }
        const data = (await response.json()) as { rates?: Record<string, Record<string, number>> };
        const rates: StoredFxRate[] = Object.entries(data.rates ?? {}).flatMap(([date, perCurrency]) => {
            const rate = perCurrency[quoteCurrency];
            return rate === undefined ? [] : [{ pair, date, rate: String(rate) }];
        });
        await this.db.fxCache.bulkPut(rates);
    }
}

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function minDate(a: string, b: string): string {
    return a <= b ? a : b;
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}
