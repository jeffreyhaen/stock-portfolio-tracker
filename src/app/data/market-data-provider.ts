export interface QuoteResult {
    readonly price: string;
    readonly currency: string;
    readonly date: string;
}

export interface DayBarDto {
    readonly date: string;
    readonly close: string;
}

export interface SplitEventDto {
    readonly date: string;
    readonly factor: string;
}

export interface HistoryResult {
    readonly currency: string;
    readonly bars: DayBarDto[];
    readonly splits: SplitEventDto[];
}

export interface TickerSuggestion {
    readonly symbol: string;
    readonly name: string;
    readonly exchange: string;
}

export interface FundamentalsResult {
    readonly symbol: string;
    readonly currency: string;
    readonly longName: string | null;
    readonly sharesOutstanding: string | null;
    readonly epsTtm: string | null;
    readonly peTtm: string | null;
    readonly marketCap: string | null;
    readonly revenueTtm: string | null;
    /** Year-over-year revenue growth as a ratio (e.g. "0.21" for 21%). */
    readonly revenueGrowthTtm: string | null;
    /** Trailing net margin as a ratio (e.g. "0.15" for 15%). */
    readonly marginTtm: string | null;
    readonly fiscalYearEnd: string | null;
    readonly revenueFy: string | null;
    readonly netIncomeFy: string | null;
}

export abstract class MarketDataProvider {
    abstract quote(symbol: string): Promise<QuoteResult>;

    async quotes(symbols: readonly string[]): Promise<Record<string, QuoteResult | { error: string }>> {
        const result: Record<string, QuoteResult | { error: string }> = {};
        for (const symbol of symbols) {
            try {
                result[symbol] = await this.quote(symbol);
            } catch (error) {
                result[symbol] = { error: String((error as Error).message ?? error) };
            }
        }
        return result;
    }

    abstract history(symbol: string, from: string, to: string): Promise<HistoryResult>;
    abstract search(query: string): Promise<TickerSuggestion[]>;

    /** Company fundamentals (shares, EPS, PE, revenue, net income). Optional capability. */
    async fundamentals(symbol: string): Promise<FundamentalsResult> {
        throw new Error(`Fundamentals are not supported for ${symbol} by this provider.`);
    }
}
