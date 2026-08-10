import { Component, computed, inject, input, signal } from '@angular/core';
import Decimal from 'decimal.js';
import { MarketDataService } from '../../data/market-data.service';
import { QuoteService } from '../../data/quote.service';
import { QuoteSyncService } from '../../data/quote-sync.service';
import { TickerSuggestion } from '../../data/quote-provider';
import { StoredQuote, StoredSecurity } from '../../data/stored-types';
import { HoldingStats } from '../../domain/holdings';
import { parseNlNumber } from '../../domain/numbers';
import { MoneyPipe } from '../../shared/money.pipe';
import { NlDatePipe } from '../../shared/nl-date.pipe';

interface QuoteRow {
    readonly isin: string;
    readonly product: string;
    readonly open: boolean;
    readonly security: StoredSecurity | null;
    readonly quote: StoredQuote | null;
    readonly stale: boolean;
    readonly invoer: string;
    readonly ongeldig: boolean;
}

interface SearchState {
    readonly query: string;
    readonly suggesties: TickerSuggestion[];
    readonly searching: boolean;
    readonly error: string | null;
}

@Component({
    selector: 'app-quote-panel',
    imports: [MoneyPipe, NlDatePipe],
    templateUrl: './quote-panel.html',
})
export class QuotePanelComponent {
    readonly holdings = input.required<readonly HoldingStats[]>();
    readonly vanafDatum = input.required<string>();

    readonly marketData = inject(MarketDataService);
    private readonly quoteService = inject(QuoteService);
    private readonly quoteSync = inject(QuoteSyncService);

    readonly edits = signal<Record<string, { invoer: string; ongeldig: boolean }>>({});
    readonly searches = signal<Record<string, SearchState>>({});
    readonly saving = signal(false);
    readonly autoLinking = signal(false);
    readonly autoLinkResult = signal<string | null>(null);

    async autoLink(): Promise<void> {
        if (this.autoLinking()) {
            return;
        }
        this.autoLinking.set(true);
        this.autoLinkResult.set(null);
        try {
            const rapport = await this.quoteSync.autoLink(this.vanafDatum());
            const delen = [`${rapport.gelinkt.length} linked`];
            if (rapport.geenKandidaat.length > 0) {
                delen.push(`${rapport.geenKandidaat.length} without a match (manual search or anchor prices)`);
            }
            this.autoLinkResult.set(delen.join(', '));
        } catch (fout) {
            this.autoLinkResult.set(`Auto-link failed: ${String((fout as Error).message ?? fout)}`);
        } finally {
            this.autoLinking.set(false);
        }
    }

    readonly rows = computed<QuoteRow[]>(() => {
        const securities = this.marketData.securities();
        const quotes = this.marketData.quotes();
        const stale = this.marketData.staleIsins();
        const edits = this.edits();
        const openIsins = new Set(this.holdings().map((h) => h.isin));
        const gesorteerd = [...securities].sort((a, b) => {
            const aOpen = openIsins.has(a.isin) ? 0 : 1;
            const bOpen = openIsins.has(b.isin) ? 0 : 1;
            return aOpen - bOpen || a.naam.localeCompare(b.naam);
        });
        return gesorteerd.map((security) => {
            const quote = quotes.find((q) => q.sleutel === security.isin) ?? null;
            const edit = edits[security.isin];
            return {
                isin: security.isin,
                product: security.naam,
                open: openIsins.has(security.isin),
                security,
                quote,
                stale: stale.has(security.isin),
                invoer: edit?.invoer ?? (quote?.bron !== 'yahoo' && quote ? new Decimal(quote.prijs).toString() : ''),
                ongeldig: edit?.ongeldig ?? false,
            };
        });
    });

    searchState(isin: string): SearchState {
        return this.searches()[isin] ?? { query: '', suggesties: [], searching: false, error: null };
    }

    onSearchInput(isin: string, query: string): void {
        this.searches.update((s) => ({
            ...s,
            [isin]: { ...this.searchState(isin), query, suggesties: [], error: null },
        }));
    }

    async find(isin: string, fallbackQuery: string): Promise<void> {
        const state = this.searchState(isin);
        const query = state.query.trim() === '' ? fallbackQuery : state.query.trim();
        this.searches.update((s) => ({ ...s, [isin]: { ...state, query, searching: true, error: null } }));
        try {
            const suggesties = await this.quoteSync.searchTicker(query);
            this.searches.update((s) => ({ ...s, [isin]: { query, suggesties, searching: false, error: null } }));
        } catch (fout) {
            this.searches.update((s) => ({
                ...s,
                [isin]: { query, suggesties: [], searching: false, error: String((fout as Error).message ?? fout) },
            }));
        }
    }

    async link(isin: string, symbol: string): Promise<void> {
        await this.quoteSync.linkTicker(isin, symbol);
        this.searches.update((s) => {
            const rest = { ...s };
            delete rest[isin];
            return rest;
        });
        await this.quoteSync.refreshSecurity(isin, this.vanafDatum());
    }

    async unlink(isin: string): Promise<void> {
        await this.quoteSync.unlinkTicker(isin);
    }

    onPriceInput(isin: string, invoer: string): void {
        this.edits.update((e) => ({ ...e, [isin]: { invoer, ongeldig: false } }));
    }

    async saveManual(): Promise<void> {
        if (this.saving()) {
            return;
        }
        const edits: Record<string, { invoer: string; ongeldig: boolean }> = {};
        for (const row of this.rows()) {
            if (!row.open || row.security?.tickerVoorKoers != null || row.invoer.trim() === '') {
                continue;
            }
            try {
                parseNlNumber(row.invoer);
            } catch {
                edits[row.isin] = { invoer: row.invoer, ongeldig: true };
            }
        }
        if (Object.keys(edits).length > 0) {
            this.edits.update((huidig) => ({ ...huidig, ...edits }));
            return;
        }
        this.saving.set(true);
        try {
            for (const row of this.rows()) {
                if (!row.open || row.security?.tickerVoorKoers != null) {
                    continue;
                }
                const ingevoerd = row.invoer.trim();
                const prijs = ingevoerd === '' ? null : parseNlNumber(ingevoerd);
                const bestaand = this.marketData.quotes().find((q) => q.sleutel === row.isin);
                if (prijs === null && bestaand !== undefined && bestaand.bron !== 'yahoo') {
                    await this.quoteService.remove(row.isin);
                } else if (prijs !== null && bestaand?.prijs !== prijs.toString()) {
                    await this.quoteService.save(row.isin, prijs, 'EUR');
                }
            }
            this.edits.set({});
            await this.marketData.reload();
        } finally {
            this.saving.set(false);
        }
    }
}
