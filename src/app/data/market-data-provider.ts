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
}
