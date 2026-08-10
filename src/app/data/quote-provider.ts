export interface QuoteResult {
    readonly prijs: string;
    readonly valuta: string;
    readonly datum: string;
}

export interface DayBarDto {
    readonly datum: string;
    readonly slotkoers: string;
}

export interface SplitEventDto {
    readonly datum: string;
    readonly factor: string;
}

export interface HistoryResult {
    readonly valuta: string;
    readonly bars: DayBarDto[];
    readonly splits: SplitEventDto[];
}

export interface TickerSuggestion {
    readonly symbol: string;
    readonly name: string;
    readonly exchange: string;
}

export abstract class QuoteProvider {
    abstract quote(symbol: string): Promise<QuoteResult>;

    async quotes(symbols: readonly string[]): Promise<Record<string, QuoteResult | { error: string }>> {
        const result: Record<string, QuoteResult | { error: string }> = {};
        for (const symbol of symbols) {
            try {
                result[symbol] = await this.quote(symbol);
            } catch (fout) {
                result[symbol] = { error: String((fout as Error).message ?? fout) };
            }
        }
        return result;
    }

    abstract history(symbol: string, from: string, to: string): Promise<HistoryResult>;
    abstract search(query: string): Promise<TickerSuggestion[]>;
}
