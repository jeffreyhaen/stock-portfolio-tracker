import { inject, Injectable } from '@angular/core';
import Decimal from 'decimal.js';
import Dexie from 'dexie';
import { chooseTickerCandidate } from '../domain/ticker-match';
import { PortfolioDatabase } from './db';
import { FxService } from './fx.service';
import { MarketDataService } from './market-data.service';
import { QuoteProvider, TickerSuggestion } from './quote-provider';

export interface RefreshReport {
    readonly quotesUpdated: number;
    readonly quotesRequested: number;
    readonly quotesFailed: string[];
    readonly historyUpdated: string[];
    readonly fxUpdated: boolean;
    readonly serviceUnavailable: boolean;
}

export const QUOTE_SERVICE_UNAVAILABLE_MESSAGE =
    'The quote service could not be reached. The service may not be running. Start it with `npm run quotes` and try again.';

export interface AutoLinkReport {
    readonly linked: { isin: string; symbol: string }[];
    readonly noCandidate: string[];
    readonly serviceUnavailable: boolean;
}

@Injectable({ providedIn: 'root' })
export class QuoteSyncService {
    private readonly db = inject(PortfolioDatabase);
    private readonly provider = inject(QuoteProvider);
    private readonly fx = inject(FxService);
    private readonly marketData = inject(MarketDataService);

    async searchTicker(query: string): Promise<TickerSuggestion[]> {
        return this.provider.search(query);
    }

    async linkTicker(isin: string, symbol: string, exchange?: string): Promise<void> {
        await this.db.securities.update(isin, {
            quoteTicker: symbol,
            ...(exchange !== undefined ? { exchange: exchange } : {}),
        });
    }

    async refreshSecurity(isin: string, fromDate: string): Promise<void> {
        const security = await this.db.securities.get(isin);
        const ticker = security?.quoteTicker;
        if (security === undefined || ticker === null || ticker === undefined) {
            return;
        }
        const reporting = this.marketData.reportingCurrency();
        this.marketData.refreshing.set(true);
        try {
            const result = await this.provider.quote(ticker);
            await this.ensureFxFor(result.currency, reporting, fromDate);
            await this.db.quoteCache.put({
                key: isin,
                price: new Decimal(result.price).toString(),
                currency: result.currency,
                timestamp: new Date().toISOString(),
                source: 'yahoo',
            });
            await this.ensureHistory(isin, ticker, fromDate);
            this.marketData.offline.set(false);
        } catch {
            this.marketData.offline.set(true);
        } finally {
            this.marketData.refreshing.set(false);
        }
        await this.marketData.reload();
    }

    async autoLink(fromDate: string, onlyIsins?: readonly string[]): Promise<AutoLinkReport> {
        const securities = await this.db.securities.toArray();
        const allowedIsins = onlyIsins === undefined ? null : new Set(onlyIsins);
        const unlinked = securities.filter(
            (s) =>
                (allowedIsins === null || allowedIsins.has(s.isin)) &&
                (s.quoteTicker === null || s.quoteTicker === undefined),
        );
        const linked: { isin: string; symbol: string }[] = [];
        const noCandidate: string[] = [];
        let serviceUnavailable = false;
        for (const security of unlinked) {
            try {
                const isinSearch = chooseTickerCandidate(
                    await this.provider.search(security.isin),
                    security.tradingCurrency,
                );
                let candidate = isinSearch.candidate;
                if (!isinSearch.currencyMatch && security.tradingCurrency !== null) {
                    const nameSearch = chooseTickerCandidate(
                        await this.provider.search(security.name),
                        security.tradingCurrency,
                    );
                    if (nameSearch.currencyMatch) {
                        candidate = nameSearch.candidate;
                    }
                }
                if (candidate === null) {
                    noCandidate.push(security.isin);
                    continue;
                }
                await this.linkTicker(security.isin, candidate.symbol, candidate.exchange);
                linked.push({ isin: security.isin, symbol: candidate.symbol });
            } catch {
                serviceUnavailable = true;
                break;
            }
        }
        if (linked.length > 0) {
            await this.refreshAll(fromDate);
        }
        return { linked, noCandidate, serviceUnavailable };
    }

    async unlinkTicker(isin: string): Promise<void> {
        await this.db.securities.update(isin, { quoteTicker: null, exchange: null });
        await this.db.priceHistory.where('isin').equals(isin).delete();
        const quote = await this.db.quoteCache.get(isin);
        if (quote?.source === 'yahoo') {
            await this.db.quoteCache.delete(isin);
        }
        await this.marketData.reload();
    }

    async refreshAll(fromDate: string): Promise<RefreshReport> {
        this.marketData.refreshing.set(true);
        try {
            const securities = await this.db.securities.toArray();
            const linkedSecurities = securities.filter((s) => s.quoteTicker !== null);
            const quotesRequested = linkedSecurities.length;
            if (quotesRequested === 0) {
                await this.marketData.reload();
                return {
                    quotesUpdated: 0,
                    quotesRequested,
                    quotesFailed: [],
                    historyUpdated: [],
                    fxUpdated: false,
                    serviceUnavailable: false,
                };
            }
            const quotesUpdated: string[] = [];
            const quotesFailed: string[] = [];
            const historyUpdated: string[] = [];
            let fxUpdated = false;
            let serviceUnavailable = false;
            const reporting = this.marketData.reportingCurrency();

            try {
                const tickers = linkedSecurities.map((s) => s.quoteTicker ?? '');
                const quotes = await this.provider.quotes(tickers);
                for (const security of linkedSecurities) {
                    const ticker = security.quoteTicker ?? '';
                    const result = quotes[ticker.toUpperCase()] ?? quotes[ticker];
                    if (result === undefined || 'error' in result) {
                        quotesFailed.push(ticker);
                        continue;
                    }
                    await this.db.quoteCache.put({
                        key: security.isin,
                        price: new Decimal(result.price).toString(),
                        currency: result.currency,
                        timestamp: new Date().toISOString(),
                        source: 'yahoo',
                    });
                    quotesUpdated.push(ticker);
                }

                const historyCurrencies = new Set<string>();
                for (const security of linkedSecurities) {
                    const ticker = security.quoteTicker ?? '';
                    try {
                        const currency = await this.ensureHistory(security.isin, ticker, fromDate);
                        if (currency !== null) {
                            historyCurrencies.add(currency);
                        }
                        historyUpdated.push(security.isin);
                    } catch {
                        quotesFailed.push(ticker);
                    }
                }
                for (const currency of historyCurrencies) {
                    await this.ensureFxFor(currency, reporting, fromDate);
                }
                fxUpdated = true;

                this.marketData.offline.set(false);
                this.marketData.lastRefresh.set(new Date().toISOString());
            } catch {
                this.marketData.offline.set(true);
                serviceUnavailable = true;
            }
            await this.marketData.reload();
            return {
                quotesUpdated: quotesUpdated.length,
                quotesRequested,
                quotesFailed,
                historyUpdated,
                fxUpdated,
                serviceUnavailable,
            };
        } finally {
            this.marketData.refreshing.set(false);
        }
    }

    private async ensureFxFor(currency: string, reporting: string, fromDate: string): Promise<void> {
        if (currency === reporting) {
            return;
        }
        await this.fx.ensureRange(`${currency}/${reporting}`, fromDate, today());
    }

    private async ensureHistory(isin: string, ticker: string, fromDate: string): Promise<string | null> {
        const latest = await this.db.priceHistory
            .where('[isin+date]')
            .between([isin, Dexie.minKey], [isin, Dexie.maxKey])
            .last();
        const cutoff = addDays(today(), -3);
        if (latest !== undefined && latest.date >= cutoff) {
            return latest.currency;
        }
        const from = latest === undefined ? fromDate : addDays(latest.date, 1);
        const result = await this.provider.history(ticker, from, today());
        await this.db.priceHistory.bulkPut(
            result.bars.map((bar) => ({
                isin,
                date: bar.date,
                close: new Decimal(bar.close).toString(),
                currency: result.currency,
            })),
        );
        if (result.splits.length > 0) {
            await this.db.splitEvents.bulkPut(
                result.splits.map((split) => ({ isin, date: split.date, factor: split.factor })),
            );
        }
        return result.currency;
    }
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
