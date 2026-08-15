import { Component, computed, inject, input, signal } from '@angular/core';
import Decimal from 'decimal.js';
import { MarketDataService } from '../../data/market-data.service';
import { QuoteService } from '../../data/quote.service';
import { QuoteSyncService } from '../../data/quote-sync.service';
import { TickerSuggestion } from '../../data/quote-provider';
import { StoredQuote, StoredSecurity } from '../../data/stored-types';
import { HoldingStats } from '../../domain/holdings';
import { parseLocalizedNumber } from '../../domain/numbers';
import { exchangeCode, stripYahooSuffix } from '../../domain/ticker-match';
import { MoneyPipe } from '../../shared/money.pipe';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { TableSort } from '../../shared/sort';
import { SortThComponent } from '../../shared/ui/sort-th';

interface QuoteRow {
    readonly isin: string;
    readonly product: string;
    readonly open: boolean;
    readonly security: StoredSecurity | null;
    readonly quote: StoredQuote | null;
    readonly stale: boolean;
    readonly input: string;
    readonly invalid: boolean;
    readonly exchangeCode: string | null;
    readonly tickerDisplay: string;
}

interface SearchState {
    readonly query: string;
    readonly suggestions: TickerSuggestion[];
    readonly searching: boolean;
    readonly error: string | null;
}

@Component({
    selector: 'app-quote-panel',
    imports: [MoneyPipe, LocalizedDatePipe, SortThComponent],
    templateUrl: './quote-panel.html',
})
export class QuotePanelComponent {
    readonly holdings = input.required<readonly HoldingStats[]>();
    readonly fromDate = input.required<string>();

    readonly marketData = inject(MarketDataService);
    private readonly quoteService = inject(QuoteService);
    private readonly quoteSync = inject(QuoteSyncService);

    readonly sort = new TableSort<'security' | 'ticker' | 'quote', QuoteRow>(
        {
            security: (row) => row.product,
            ticker: (row) => row.security?.quoteTicker ?? null,
            quote: (row) => (row.quote === null ? null : new Decimal(row.quote.price)),
        },
        'security',
    );

    readonly edits = signal<Record<string, { input: string; invalid: boolean }>>({});
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
            const report = await this.quoteSync.autoLink(this.fromDate());
            const parts = [`${report.linked.length} linked`];
            if (report.noCandidate.length > 0) {
                parts.push(`${report.noCandidate.length} without a match (manual search or anchor prices)`);
            }
            this.autoLinkResult.set(parts.join(', '));
        } catch (error) {
            this.autoLinkResult.set(`Auto-link failed: ${String((error as Error).message ?? error)}`);
        } finally {
            this.autoLinking.set(false);
        }
    }

    readonly rows = computed<QuoteRow[]>(() => {
        const securities = this.marketData.securities();
        const quotes = this.marketData.quotes();
        const stale = this.marketData.staleIsins();
        const edits = this.edits();
        const openIsins = new Set(
            this.holdings()
                .filter((h) => h.open)
                .map((h) => h.isin),
        );
        const rows = securities.map((security) => {
            const quote = quotes.find((q) => q.key === security.isin) ?? null;
            const edit = edits[security.isin];
            const code = security.exchange !== null ? exchangeCode(security.exchange) : null;
            const tickerDisplay =
                security.quoteTicker !== null && security.quoteTicker !== undefined
                    ? stripYahooSuffix(security.quoteTicker)
                    : '';
            return {
                isin: security.isin,
                product: security.name,
                open: openIsins.has(security.isin),
                security,
                quote,
                stale: stale.has(security.isin),
                input: edit?.input ?? (quote?.source !== 'yahoo' && quote ? new Decimal(quote.price).toString() : ''),
                invalid: edit?.invalid ?? false,
                exchangeCode: code,
                tickerDisplay,
            };
        });
        const open = rows.filter((row) => row.open);
        const closed = rows.filter((row) => !row.open);
        return [...this.sort.apply(open), ...this.sort.apply(closed)];
    });

    async refreshQuotes(): Promise<void> {
        await this.quoteSync.refreshAll(this.fromDate());
    }

    searchState(isin: string): SearchState {
        return this.searches()[isin] ?? { query: '', suggestions: [], searching: false, error: null };
    }

    onSearchInput(isin: string, query: string): void {
        this.searches.update((s) => ({
            ...s,
            [isin]: { ...this.searchState(isin), query, suggestions: [], error: null },
        }));
    }

    async find(isin: string, fallbackQuery: string): Promise<void> {
        const state = this.searchState(isin);
        const query = state.query.trim() === '' ? fallbackQuery : state.query.trim();
        this.searches.update((s) => ({ ...s, [isin]: { ...state, query, searching: true, error: null } }));
        try {
            const suggestions = await this.quoteSync.searchTicker(query);
            this.searches.update((s) => ({ ...s, [isin]: { query, suggestions, searching: false, error: null } }));
        } catch (error) {
            this.searches.update((s) => ({
                ...s,
                [isin]: { query, suggestions: [], searching: false, error: String((error as Error).message ?? error) },
            }));
        }
    }

    async link(isin: string, symbol: string, exchange?: string): Promise<void> {
        await this.quoteSync.linkTicker(isin, symbol, exchange);
        this.searches.update((s) => {
            const rest = { ...s };
            delete rest[isin];
            return rest;
        });
        await this.quoteSync.refreshSecurity(isin, this.fromDate());
    }

    async unlink(isin: string): Promise<void> {
        await this.quoteSync.unlinkTicker(isin);
    }

    onPriceInput(isin: string, input: string): void {
        this.edits.update((e) => ({ ...e, [isin]: { input, invalid: false } }));
    }

    async saveManual(): Promise<void> {
        if (this.saving()) {
            return;
        }
        const edits: Record<string, { input: string; invalid: boolean }> = {};
        for (const row of this.rows()) {
            if (!row.open || row.security?.quoteTicker != null || row.input.trim() === '') {
                continue;
            }
            try {
                parseLocalizedNumber(row.input);
            } catch {
                edits[row.isin] = { input: row.input, invalid: true };
            }
        }
        if (Object.keys(edits).length > 0) {
            this.edits.update((current) => ({ ...current, ...edits }));
            return;
        }
        this.saving.set(true);
        try {
            for (const row of this.rows()) {
                if (!row.open || row.security?.quoteTicker != null) {
                    continue;
                }
                const entered = row.input.trim();
                const price = entered === '' ? null : parseLocalizedNumber(entered);
                const existing = this.marketData.quotes().find((q) => q.key === row.isin);
                if (price === null && existing !== undefined && existing.source !== 'yahoo') {
                    await this.quoteService.remove(row.isin);
                } else if (price !== null && existing?.price !== price.toString()) {
                    await this.quoteService.save(row.isin, price, 'EUR');
                }
            }
            this.edits.set({});
            await this.marketData.reload();
        } finally {
            this.saving.set(false);
        }
    }
}
