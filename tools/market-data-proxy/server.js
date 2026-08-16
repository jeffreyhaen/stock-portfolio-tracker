import http from 'node:http';

const PORT = Number(process.env.MARKET_DATA_PROXY_PORT ?? 8787);
const QUOTE_TTL_MS = 15 * 60 * 1000;
const YAHOO_HOST = 'query1.finance.yahoo.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockPortfolioApp/1.0';

// LSE quotes are in pence (GBp): normalize them to GBP.
function normalizeCurrency(price, currency) {
    if (currency === 'GBp' || currency === 'GBX') {
        return { price: price / 100, currency: 'GBP' };
    }
    return { price, currency };
}

const quoteCache = new Map();
const historyCache = new Map();
const searchCache = new Map();

function cached(map, key, ttlMs) {
    const hit = map.get(key);
    if (hit !== undefined && (ttlMs === null || Date.now() - hit.at < ttlMs)) {
        return hit.value;
    }
    return undefined;
}

function store(map, key, value) {
    map.set(key, { at: Date.now(), value });
    return value;
}

async function yahoo(path) {
    const response = await fetch(`https://${YAHOO_HOST}${path}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        throw new Error(`Yahoo ${response.status} for ${path}`);
    }
    return response.json();
}

function dateFromTimestamp(seconds) {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
}

async function fetchQuote(symbol) {
    const key = symbol.toUpperCase();
    const hit = cached(quoteCache, key, QUOTE_TTL_MS);
    if (hit !== undefined) {
        return hit;
    }
    const data = await yahoo(`/v8/finance/chart/${encodeURIComponent(key)}?range=5d&interval=1d`);
    const result = data.chart?.result?.[0];
    if (!result) {
        throw new Error(`No quote data for ${key}`);
    }
    const meta = result.meta;
    const price = meta.regularMarketPrice ?? result.indicators?.quote?.[0]?.close?.filter((c) => c !== null).at(-1);
    if (price === undefined || price === null) {
        throw new Error(`No closing price for ${key}`);
    }
    const normalized = normalizeCurrency(price, meta.currency ?? null);
    return store(quoteCache, key, {
        price: normalized.price,
        currency: normalized.currency,
        time: dateFromTimestamp(meta.regularMarketTime ?? Date.now() / 1000),
    });
}

async function fetchHistory(symbol, from, to) {
    const key = `${symbol.toUpperCase()}|${from}|${to}`;
    const hit = cached(historyCache, key, null);
    if (hit !== undefined) {
        return hit;
    }
    const period1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
    const period2 = Math.floor(new Date(`${to}T00:00:00Z`).getTime() / 1000) + 86400;
    const data = await yahoo(
        `/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplit`,
    );
    const result = data.chart?.result?.[0];
    if (!result) {
        throw new Error(`No history for ${symbol}`);
    }
    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const metaCurrency = result.meta?.currency ?? null;
    const isPence = metaCurrency === 'GBp' || metaCurrency === 'GBX';
    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
        const close = closes[i];
        if (close !== null && close !== undefined) {
            bars.push({ date: dateFromTimestamp(timestamps[i]), close: isPence ? close / 100 : close });
        }
    }
    const splits = [];
    for (const event of Object.values(result.events?.splits ?? {})) {
        if (event.numerator && event.denominator) {
            splits.push({
                date: dateFromTimestamp(event.date),
                factor: event.numerator / event.denominator,
            });
        }
    }
    return store(historyCache, key, {
        currency: isPence ? 'GBP' : metaCurrency,
        bars,
        splits,
    });
}

async function search(query) {
    const key = query.toLowerCase();
    const hit = cached(searchCache, key, QUOTE_TTL_MS);
    if (hit !== undefined) {
        return hit;
    }
    const data = await yahoo(`/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`);
    const suggestions = (data.quotes ?? [])
        .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
        .map((q) => ({
            symbol: q.symbol,
            name: q.shortname ?? q.longname ?? q.symbol,
            exchange: q.exchDisp ?? q.exchange ?? '',
        }));
    return store(searchCache, key, suggestions);
}

function json(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET',
                'Access-Control-Allow-Headers': 'content-type',
            });
            res.end();
            return;
        }
        if (url.pathname === '/api/health') {
            json(res, 200, { ok: true });
            return;
        }
        if (url.pathname === '/api/quote') {
            const symbols = (url.searchParams.get('symbols') ?? '')
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s !== '');
            if (symbols.length === 0 || symbols.length > 50) {
                json(res, 400, { error: 'symbols are required (maximum 50)' });
                return;
            }
            const result = {};
            for (const symbol of symbols) {
                try {
                    result[symbol.toUpperCase()] = await fetchQuote(symbol);
                } catch (error) {
                    result[symbol.toUpperCase()] = { error: String(error.message ?? error) };
                }
            }
            json(res, 200, result);
            return;
        }
        if (url.pathname === '/api/history') {
            const symbol = url.searchParams.get('symbol');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) {
                json(res, 400, { error: 'symbol, from, and to (YYYY-MM-DD) are required' });
                return;
            }
            json(res, 200, await fetchHistory(symbol, from, to));
            return;
        }
        if (url.pathname === '/api/search') {
            const q = url.searchParams.get('q') ?? '';
            if (q.trim() === '') {
                json(res, 400, { error: 'q is required' });
                return;
            }
            json(res, 200, await search(q));
            return;
        }
        json(res, 404, { error: 'unknown endpoint' });
    } catch (error) {
        json(res, 502, { error: String(error.message ?? error) });
    }
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(
            `Port ${PORT} is already in use — is a market-data proxy already running? (or choose another port with MARKET_DATA_PROXY_PORT)`,
        );
        process.exit(1);
    }
    throw error;
});

server.listen(PORT, () => {
    console.log(`market-data proxy listening on http://localhost:${PORT}`);
});
