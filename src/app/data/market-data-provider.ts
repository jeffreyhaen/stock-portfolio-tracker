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
    /** Trailing earnings growth as a ratio (e.g. "0.35" for 35%). */
    readonly earningsGrowthTtm: string | null;
    /** Trailing net margin as a ratio (e.g. "0.15" for 15%). */
    readonly marginTtm: string | null;
    /** Trailing gross margin as a ratio. */
    readonly grossMargins: string | null;
    /** Forward P/E based on the current-year analyst EPS estimate. */
    readonly forwardPe: string | null;
    /** Trailing price-to-sales ratio. */
    readonly priceToSalesTtm: string | null;
    readonly fiscalYearEnd: string | null;
    readonly revenueFy: string | null;
    readonly netIncomeFy: string | null;
    /** Net income of the prior fiscal year; with netIncomeFy this gives a last-year earnings growth proxy. */
    readonly netIncomeFyPrev: string | null;
    /** Analyst estimates from the earningsTrend module (current quarter, current/next fiscal year). */
    readonly estimates: FundamentalsEstimates;
}

export interface FundamentalsEstimates {
    /** Expected EPS growth for the current quarter vs the year-ago quarter (ratio). */
    readonly epsGrowthCurrentQtr: string | null;
    /** Expected EPS growth for the current fiscal year vs last year (ratio). */
    readonly epsGrowthCurrentFy: string | null;
    /** Expected EPS growth for the next fiscal year (ratio). */
    readonly epsGrowthNextFy: string | null;
    /** Expected revenue growth for the current fiscal year (ratio). */
    readonly revGrowthCurrentFy: string | null;
    /** Expected revenue growth for the next fiscal year (ratio). */
    readonly revGrowthNextFy: string | null;
    /** Consensus EPS estimate for the current fiscal year. */
    readonly epsEstimateCurrentFy: string | null;
    /** Consensus EPS estimate for the next fiscal year. */
    readonly epsEstimateNextFy: string | null;
    /** Consensus revenue estimate for the next fiscal year. */
    readonly revenueEstimateNextFy: string | null;
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
