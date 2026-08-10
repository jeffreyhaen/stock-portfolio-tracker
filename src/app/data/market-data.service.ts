import { computed, inject, Injectable, signal } from '@angular/core';
import Decimal from 'decimal.js';
import { buildFxResolver, FxResolver } from '../domain/fx';
import { QuoteInput } from '../domain/valuation';
import { PortfolioDatabase } from './db';
import { StoredPriceBar, StoredQuote, StoredSecurity, StoredSplitEvent } from './stored-types';

const STALE_NA_DAGEN = 3;

@Injectable({ providedIn: 'root' })
export class MarketDataService {
    private readonly db = inject(PortfolioDatabase);

    readonly quotes = signal<StoredQuote[]>([]);
    readonly fxRates = signal<{ paar: string; datum: string; koers: string }[]>([]);
    readonly priceHistory = signal<StoredPriceBar[]>([]);
    readonly splitEvents = signal<StoredSplitEvent[]>([]);
    readonly securities = signal<StoredSecurity[]>([]);
    readonly offline = signal(false);
    readonly refreshing = signal(false);
    readonly laatsteRefresh = signal<string | null>(null);

    readonly quoteMap = computed<ReadonlyMap<string, QuoteInput>>(() => {
        const map = new Map<string, QuoteInput>();
        for (const quote of this.quotes()) {
            map.set(quote.sleutel, { prijs: new Decimal(quote.prijs), valuta: quote.valuta });
        }
        return map;
    });

    readonly fxResolver = computed<FxResolver>(() => buildFxResolver(this.fxRates()));

    readonly staleIsins = computed<Set<string>>(() => {
        const grens = new Date(Date.now() - STALE_NA_DAGEN * 24 * 60 * 60 * 1000).toISOString();
        const stale = new Set<string>();
        for (const quote of this.quotes()) {
            if (quote.bron === 'yahoo' && quote.tijdstip < grens) {
                stale.add(quote.sleutel);
            }
        }
        return stale;
    });

    async reload(): Promise<void> {
        const [quotes, fxRates, priceHistory, securities, splitEvents] = await Promise.all([
            this.db.quoteCache.toArray(),
            this.db.fxCache.toArray(),
            this.db.priceHistory.toArray(),
            this.db.securities.toArray(),
            this.db.splitEvents.toArray(),
        ]);
        this.quotes.set(quotes);
        this.fxRates.set(fxRates);
        this.priceHistory.set(priceHistory);
        this.securities.set(securities);
        this.splitEvents.set(splitEvents);
    }
}
