import { YahooMarketDataProvider } from './yahoo-market-data-provider';

describe('YahooMarketDataProvider', () => {
    it('splits quote requests into proxy-sized batches', async () => {
        const requests: string[] = [];
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            requests.push(url);
            const symbols = new URL(url).searchParams.get('symbols')?.split(',') ?? [];
            return new Response(
                JSON.stringify(
                    Object.fromEntries(
                        symbols.map((symbol) => [
                            symbol.toUpperCase(),
                            { price: 42, currency: 'EUR', time: '2026-08-27' },
                        ]),
                    ),
                ),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
        });

        try {
            const provider = new YahooMarketDataProvider();
            provider.setBaseUrl('http://proxy.test/');
            const symbols = Array.from({ length: 51 }, (_, index) => `SYM${index}`);
            const result = await provider.quotes(symbols);

            expect(requests).toHaveLength(2);
            expect(new URL(requests[0]).searchParams.get('symbols')?.split(',')).toHaveLength(50);
            expect(new URL(requests[1]).searchParams.get('symbols')?.split(',')).toHaveLength(1);
            expect(Object.keys(result)).toHaveLength(51);
            expect(result['SYM50']).toEqual({ price: '42', currency: 'EUR', date: '2026-08-27' });
        } finally {
            fetch.mockRestore();
        }
    });
});
