import { YahooMarketDataProvider } from './yahoo-market-data-provider';

describe('YahooMarketDataProvider', () => {
    it('maps proxy fundamentals to string fields', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            return new Response(
                JSON.stringify({
                    symbol: 'AMD',
                    currency: 'USD',
                    longName: 'Advanced Micro Devices, Inc.',
                    sharesOutstanding: 1632475042,
                    epsTtm: 4.11,
                    peTtm: null,
                    marketCap: 779621105664,
                    revenueTtm: 41305001984,
                    marginTtm: 0.15577,
                    fiscalYearEnd: '2025-12-31',
                    revenueFy: 34639000000,
                    netIncomeFy: 4335000000,
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
        });

        try {
            const provider = new YahooMarketDataProvider();
            provider.setBaseUrl('http://proxy.test/');
            const result = await provider.fundamentals('AMD');

            expect(result.symbol).toBe('AMD');
            expect(result.currency).toBe('USD');
            expect(result.sharesOutstanding).toBe('1632475042');
            expect(result.epsTtm).toBe('4.11');
            expect(result.peTtm).toBeNull();
            expect(result.revenueFy).toBe('34639000000');
            expect(result.netIncomeFy).toBe('4335000000');
            expect(result.fiscalYearEnd).toBe('2025-12-31');
        } finally {
            fetch.mockRestore();
        }
    });

    it('propagates proxy fundamentals errors', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify({ error: 'No fundamentals for NOPE' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        try {
            const provider = new YahooMarketDataProvider();
            provider.setBaseUrl('http://proxy.test/');
            await expect(provider.fundamentals('NOPE')).rejects.toThrow('No fundamentals for NOPE');
        } finally {
            fetch.mockRestore();
        }
    });

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
