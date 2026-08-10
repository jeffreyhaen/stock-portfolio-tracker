import { inject, Injectable } from '@angular/core';
import Decimal from 'decimal.js';
import Dexie from 'dexie';
import { PortfolioDatabase } from './db';
import { FxService } from './fx.service';
import { MarketDataService } from './market-data.service';
import { QuoteProvider, TickerSuggestion } from './quote-provider';

export interface RefreshReport {
    readonly quotesBijgewerkt: number;
    readonly quotesMislukt: string[];
    readonly historieBijgewerkt: string[];
    readonly fxBijgewerkt: boolean;
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

    async linkTicker(isin: string, symbol: string): Promise<void> {
        await this.db.securities.update(isin, { tickerVoorKoers: symbol });
    }

    async refreshSecurity(isin: string, vanafDatum: string): Promise<void> {
        const security = await this.db.securities.get(isin);
        const ticker = security?.tickerVoorKoers;
        if (security === undefined || ticker === null || ticker === undefined) {
            return;
        }
        this.marketData.refreshing.set(true);
        try {
            await this.fx.ensureRange('USD/EUR', vanafDatum, vandaag());
            const result = await this.provider.quote(ticker);
            await this.db.quoteCache.put({
                sleutel: isin,
                prijs: new Decimal(result.prijs).toString(),
                valuta: result.valuta,
                tijdstip: new Date().toISOString(),
                bron: 'yahoo',
            });
            await this.ensureHistory(isin, ticker, vanafDatum);
            this.marketData.offline.set(false);
        } catch {
            this.marketData.offline.set(true);
        } finally {
            this.marketData.refreshing.set(false);
        }
        await this.marketData.reload();
    }

    async unlinkTicker(isin: string): Promise<void> {
        await this.db.securities.update(isin, { tickerVoorKoers: null });
        await this.db.priceHistory.where('isin').equals(isin).delete();
        const quote = await this.db.quoteCache.get(isin);
        if (quote?.bron === 'yahoo') {
            await this.db.quoteCache.delete(isin);
        }
        await this.marketData.reload();
    }

    async refreshAll(vanafDatum: string): Promise<RefreshReport> {
        this.marketData.refreshing.set(true);
        try {
            const securities = await this.db.securities.toArray();
            const gekoppeld = securities.filter((s) => s.tickerVoorKoers !== null);
            const quotesBijgewerkt: string[] = [];
            const quotesMislukt: string[] = [];
            const historieBijgewerkt: string[] = [];
            let fxBijgewerkt = false;

            try {
                await this.fx.ensureRange('USD/EUR', vanafDatum, vandaag());
                fxBijgewerkt = true;

                const tickers = gekoppeld.map((s) => s.tickerVoorKoers ?? '');
                const quotes = await this.provider.quotes(tickers);
                for (const security of gekoppeld) {
                    const ticker = security.tickerVoorKoers ?? '';
                    const result = quotes[ticker.toUpperCase()] ?? quotes[ticker];
                    if (result === undefined || 'error' in result) {
                        quotesMislukt.push(ticker);
                        continue;
                    }
                    await this.db.quoteCache.put({
                        sleutel: security.isin,
                        prijs: new Decimal(result.prijs).toString(),
                        valuta: result.valuta,
                        tijdstip: new Date().toISOString(),
                        bron: 'yahoo',
                    });
                    quotesBijgewerkt.push(ticker);
                }

                const historieValutas = new Set<string>();
                for (const security of gekoppeld) {
                    const ticker = security.tickerVoorKoers ?? '';
                    try {
                        const valuta = await this.ensureHistory(security.isin, ticker, vanafDatum);
                        if (valuta !== null) {
                            historieValutas.add(valuta);
                        }
                        historieBijgewerkt.push(security.isin);
                    } catch {
                        quotesMislukt.push(ticker);
                    }
                }
                for (const valuta of historieValutas) {
                    if (valuta !== 'EUR' && valuta !== 'USD') {
                        await this.fx.ensureRange(`${valuta}/EUR`, vanafDatum, vandaag());
                    }
                }

                this.marketData.offline.set(false);
                this.marketData.laatsteRefresh.set(new Date().toISOString());
            } catch {
                this.marketData.offline.set(true);
            }
            await this.marketData.reload();
            return { quotesBijgewerkt: quotesBijgewerkt.length, quotesMislukt, historieBijgewerkt, fxBijgewerkt };
        } finally {
            this.marketData.refreshing.set(false);
        }
    }

    private async ensureHistory(isin: string, ticker: string, vanafDatum: string): Promise<string | null> {
        const laatste = await this.db.priceHistory
            .where('[isin+datum]')
            .between([isin, Dexie.minKey], [isin, Dexie.maxKey])
            .last();
        const grens = plusDagen(vandaag(), -3);
        if (laatste !== undefined && laatste.datum >= grens) {
            return laatste.valuta;
        }
        const from = laatste === undefined ? vanafDatum : plusDagen(laatste.datum, 1);
        const result = await this.provider.history(ticker, from, vandaag());
        await this.db.priceHistory.bulkPut(
            result.bars.map((bar) => ({
                isin,
                datum: bar.datum,
                slotkoers: new Decimal(bar.slotkoers).toString(),
                valuta: result.valuta,
            })),
        );
        if (result.splits.length > 0) {
            await this.db.splitEvents.bulkPut(
                result.splits.map((split) => ({ isin, datum: split.datum, factor: split.factor })),
            );
        }
        return result.valuta;
    }
}

function vandaag(): string {
    return new Date().toISOString().slice(0, 10);
}

function plusDagen(datum: string, dagen: number): string {
    const d = new Date(`${datum}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dagen);
    return d.toISOString().slice(0, 10);
}
