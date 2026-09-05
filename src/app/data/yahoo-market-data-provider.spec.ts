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
                    grossMargins: 0.49,
                    forwardPe: 40.2,
                    priceToSalesTtm: 8.9,
                    earningsGrowthTtm: 0.35,
                    fiscalYearEnd: '2025-12-31',
                    revenueFy: 34639000000,
                    netIncomeFy: 4335000000,
                    netIncomeFyPrev: 3100000000,
                    estimates: {
                        epsGrowthCurrentQtr: 0.4,
                        epsGrowthCurrentFy: 0.45,
                        epsGrowthNextFy: 0.25,
                        revGrowthCurrentFy: 0.18,
                        revGrowthNextFy: 0.12,
                        epsEstimateCurrentFy: 5.96,
                        epsEstimateNextFy: 7.45,
                        revenueEstimateNextFy: 52600000000,
                    },
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
            expect(result.earningsGrowthTtm).toBe('0.35');
            expect(result.grossMargins).toBe('0.49');
            expect(result.forwardPe).toBe('40.2');
            expect(result.priceToSalesTtm).toBe('8.9');
            expect(result.netIncomeFyPrev).toBe('3100000000');
            expect(result.estimates.epsGrowthCurrentQtr).toBe('0.4');
            expect(result.estimates.epsEstimateNextFy).toBe('7.45');
            expect(result.estimates.revenueEstimateNextFy).toBe('52600000000');
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
