import { computed, inject, Injectable, signal } from '@angular/core';
import Decimal from 'decimal.js';
import { buildFxResolver, FxResolver } from '../domain/fx';
import { QuoteInput } from '../domain/valuation';
import { PortfolioDatabase } from './db';
import { PortfolioContext } from './portfolio-context';
import { StoredPriceBar, StoredQuote, StoredSecurity, StoredSplitEvent } from './stored-types';

const STALE_AFTER_DAYS = 3;

@Injectable({ providedIn: 'root' })
export class MarketDataService {
    private readonly db = inject(PortfolioDatabase);
    private readonly context = inject(PortfolioContext);

    readonly quotes = signal<StoredQuote[]>([]);
    readonly fxRates = signal<{ pair: string; date: string; rate: string }[]>([]);
    readonly priceHistory = signal<StoredPriceBar[]>([]);
    readonly splitEvents = signal<StoredSplitEvent[]>([]);
    readonly securities = signal<StoredSecurity[]>([]);
    readonly offline = signal(false);
    readonly refreshing = signal(false);
    readonly lastRefresh = signal<string | null>(null);
    readonly cacheReady = signal(false);
    readonly ready: Promise<void>;
    private reloadInFlight: Promise<void> | null = null;
    private reloadRequested = false;

    constructor() {
        this.ready = this.reload();
    }

    readonly quoteMap = computed<ReadonlyMap<string, QuoteInput>>(() => {
        const map = new Map<string, QuoteInput>();
        const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
        for (const quote of this.quotes()) {
            map.set(quote.key, {
                price: new Decimal(quote.price),
                currency: quote.currency,
                date: quote.timestamp.slice(0, 10),
                source: quote.source === 'manual' ? 'manual' : 'market',
                stale: quote.source === 'yahoo' && quote.timestamp < cutoff,
            });
        }
        return map;
    });

    readonly reportingCurrency = computed(() => this.context.selectedPortfolio()?.reportingCurrency ?? 'EUR');

    readonly fxResolver = computed<FxResolver>(() => buildFxResolver(this.fxRates(), this.reportingCurrency()));

    readonly staleIsins = computed<Set<string>>(() => {
        const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const stale = new Set<string>();
        for (const quote of this.quotes()) {
            if (quote.source === 'yahoo' && quote.timestamp < cutoff) {
                stale.add(quote.key);
            }
        }
        return stale;
    });

    reload(): Promise<void> {
        if (this.reloadInFlight !== null) {
            this.reloadRequested = true;
            return this.reloadInFlight;
        }
        const reload = this.loadUntilQuiet().finally(() => {
            if (this.reloadInFlight === reload) {
                this.reloadInFlight = null;
            }
        });
        this.reloadInFlight = reload;
        return reload;
    }

    private async loadUntilQuiet(): Promise<void> {
        do {
            this.reloadRequested = false;
            await this.loadCache();
        } while (this.reloadRequested);
    }

    private async loadCache(): Promise<void> {
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
        this.cacheReady.set(true);
    }
}
