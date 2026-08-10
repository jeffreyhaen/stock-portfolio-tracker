import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { StoredFxRate } from './stored-types';

const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';
const CHUNK_DAGEN = 370;

@Injectable({ providedIn: 'root' })
export class FxService {
    private readonly db = inject(PortfolioDatabase);

    async list(): Promise<StoredFxRate[]> {
        return this.db.fxCache.toArray();
    }

    async laatsteDatum(paar: string): Promise<string | null> {
        const laatste = await this.db.fxCache
            .where('[paar+datum]')
            .between([paar, Dexie.minKey], [paar, Dexie.maxKey])
            .last();
        return laatste?.datum ?? null;
    }

    async ensureRange(paar: string, from: string, to: string): Promise<void> {
        const [van, naar] = paar.split('/');
        let cursor = from;
        while (cursor <= to) {
            const chunkEinde = minDatum(plusDagen(cursor, CHUNK_DAGEN), to);
            await this.haalRange(paar, van, naar, cursor, chunkEinde);
            cursor = plusDagen(chunkEinde, 1);
        }
    }

    private async haalRange(paar: string, van: string, naar: string, from: string, to: string): Promise<void> {
        const bestaand = await this.db.fxCache.where('[paar+datum]').between([paar, from], [paar, to]).count();
        if (bestaand > 0) {
            const grens = plusDagen(vandaag(), -4);
            const inVerledenAfgerond = to < grens;
            const laatste = await this.db.fxCache.where('[paar+datum]').between([paar, from], [paar, to]).last();
            if (inVerledenAfgerond || (laatste !== undefined && laatste.datum >= grens)) {
                return;
            }
        }
        const response = await fetch(`${FRANKFURTER_BASE}/${from}..${to}?base=${van}&symbols=${naar}`, {
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
            throw new Error(`Frankfurter ${response.status} voor ${paar} ${from}..${to}`);
        }
        const data = (await response.json()) as { rates?: Record<string, Record<string, number>> };
        const rates: StoredFxRate[] = Object.entries(data.rates ?? {}).flatMap(([datum, perValuta]) => {
            const koers = perValuta[naar];
            return koers === undefined ? [] : [{ paar, datum, koers: String(koers) }];
        });
        await this.db.fxCache.bulkPut(rates);
    }
}

function plusDagen(datum: string, dagen: number): string {
    const d = new Date(`${datum}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dagen);
    return d.toISOString().slice(0, 10);
}

function minDatum(a: string, b: string): string {
    return a <= b ? a : b;
}

function vandaag(): string {
    return new Date().toISOString().slice(0, 10);
}
