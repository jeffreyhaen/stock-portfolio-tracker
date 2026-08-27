import { Injectable } from '@angular/core';
import { DayBarDto, HistoryResult, MarketDataProvider, QuoteResult, TickerSuggestion } from './market-data-provider';

const DEFAULT_BASE_URL = 'http://localhost:8787';
const MAX_QUOTES_PER_REQUEST = 50;

interface ProxyQuote {
    price?: number;
    currency?: string;
    time?: string;
    error?: string;
}

@Injectable({ providedIn: 'root' })
export class YahooMarketDataProvider extends MarketDataProvider {
    private baseUrl = DEFAULT_BASE_URL;

    setBaseUrl(url: string): void {
        this.baseUrl = url.replace(/\/$/, '');
    }

    private async getJson<T>(pad: string): Promise<T> {
        const response = await fetch(`${this.baseUrl}${pad}`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? `proxy ${response.status}`);
        }
        return (await response.json()) as T;
    }

    async quote(symbol: string): Promise<QuoteResult> {
        const data = await this.getJson<Record<string, ProxyQuote>>(`/api/quote?symbols=${encodeURIComponent(symbol)}`);
        const entry = data[symbol.toUpperCase()];
        if (entry === undefined || entry.error !== undefined || entry.price === undefined) {
            throw new Error(entry?.error ?? `No quote for ${symbol}`);
        }
        return { price: String(entry.price), currency: entry.currency ?? 'EUR', date: entry.time ?? '' };
    }

    override async quotes(symbols: readonly string[]): Promise<Record<string, QuoteResult | { error: string }>> {
        if (symbols.length === 0) {
            return {};
        }
        const result: Record<string, QuoteResult | { error: string }> = {};
        for (let offset = 0; offset < symbols.length; offset += MAX_QUOTES_PER_REQUEST) {
            const batch = symbols.slice(offset, offset + MAX_QUOTES_PER_REQUEST);
            const data = await this.getJson<Record<string, ProxyQuote>>(
                `/api/quote?symbols=${batch.map(encodeURIComponent).join(',')}`,
            );
            for (const symbol of batch) {
                const entry = data[symbol.toUpperCase()];
                if (entry === undefined || entry.error !== undefined || entry.price === undefined) {
                    result[symbol] = { error: entry?.error ?? `No quote for ${symbol}` };
                } else {
                    result[symbol] = {
                        price: String(entry.price),
                        currency: entry.currency ?? 'EUR',
                        date: entry.time ?? '',
                    };
                }
            }
        }
        return result;
    }

    async history(symbol: string, from: string, to: string): Promise<HistoryResult> {
        const data = await this.getJson<{
            currency: string | null;
            bars: { date: string; close: number }[];
            splits?: { date: string; factor: number }[];
        }>(`/api/history?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`);
        const bars: DayBarDto[] = data.bars.map((bar) => ({ date: bar.date, close: String(bar.close) }));
        const splits = (data.splits ?? []).map((s) => ({ date: s.date, factor: String(s.factor) }));
        return { currency: data.currency ?? 'EUR', bars, splits };
    }

    async search(query: string): Promise<TickerSuggestion[]> {
        return this.getJson<TickerSuggestion[]>(`/api/search?q=${encodeURIComponent(query)}`);
    }
}
