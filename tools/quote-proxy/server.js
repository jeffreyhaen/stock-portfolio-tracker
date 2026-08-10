import http from 'node:http';

const PORT = Number(process.env.QUOTE_PROXY_PORT ?? 8787);
const QUOTE_TTL_MS = 15 * 60 * 1000;
const YAHOO_HOST = 'query1.finance.yahoo.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockPortfolioApp/1.0';

// LSE noteert in pence (GBp): normaliseer naar GBP.
function normaliseerValuta(prijs, valuta) {
    if (valuta === 'GBp' || valuta === 'GBX') {
        return { prijs: prijs / 100, valuta: 'GBP' };
    }
    return { prijs, valuta };
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
        throw new Error(`Yahoo ${response.status} voor ${path}`);
    }
    return response.json();
}

function datumVanTimestamp(seconden) {
    return new Date(seconden * 1000).toISOString().slice(0, 10);
}

async function haalQuote(symbol) {
    const key = symbol.toUpperCase();
    const hit = cached(quoteCache, key, QUOTE_TTL_MS);
    if (hit !== undefined) {
        return hit;
    }
    const data = await yahoo(`/v8/finance/chart/${encodeURIComponent(key)}?range=5d&interval=1d`);
    const result = data.chart?.result?.[0];
    if (!result) {
        throw new Error(`Geen koersdata voor ${key}`);
    }
    const meta = result.meta;
    const prijs = meta.regularMarketPrice ?? result.indicators?.quote?.[0]?.close?.filter((c) => c !== null).at(-1);
    if (prijs === undefined || prijs === null) {
        throw new Error(`Geen slotkoers voor ${key}`);
    }
    const norm = normaliseerValuta(prijs, meta.currency ?? null);
    return store(quoteCache, key, {
        price: norm.prijs,
        currency: norm.valuta,
        time: datumVanTimestamp(meta.regularMarketTime ?? Date.now() / 1000),
    });
}

async function haalHistorie(symbol, from, to) {
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
        throw new Error(`Geen historie voor ${symbol}`);
    }
    const tijden = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const metaValuta = result.meta?.currency ?? null;
    const isPence = metaValuta === 'GBp' || metaValuta === 'GBX';
    const bars = [];
    for (let i = 0; i < tijden.length; i++) {
        const slot = closes[i];
        if (slot !== null && slot !== undefined) {
            bars.push({ date: datumVanTimestamp(tijden[i]), close: isPence ? slot / 100 : slot });
        }
    }
    const splits = [];
    for (const event of Object.values(result.events?.splits ?? {})) {
        if (event.numerator && event.denominator) {
            splits.push({
                date: datumVanTimestamp(event.date),
                factor: event.numerator / event.denominator,
            });
        }
    }
    return store(historyCache, key, {
        currency: isPence ? 'GBP' : metaValuta,
        bars,
        splits,
    });
}

async function zoek(query) {
    const key = query.toLowerCase();
    const hit = cached(searchCache, key, QUOTE_TTL_MS);
    if (hit !== undefined) {
        return hit;
    }
    const data = await yahoo(`/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`);
    const suggesties = (data.quotes ?? [])
        .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
        .map((q) => ({
            symbol: q.symbol,
            name: q.shortname ?? q.longname ?? q.symbol,
            exchange: q.exchDisp ?? q.exchange ?? '',
        }));
    return store(searchCache, key, suggesties);
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
                json(res, 400, { error: 'symbols verplicht (max 50)' });
                return;
            }
            const result = {};
            for (const symbol of symbols) {
                try {
                    result[symbol.toUpperCase()] = await haalQuote(symbol);
                } catch (fout) {
                    result[symbol.toUpperCase()] = { error: String(fout.message ?? fout) };
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
                json(res, 400, { error: 'symbol, from en to (YYYY-MM-DD) verplicht' });
                return;
            }
            json(res, 200, await haalHistorie(symbol, from, to));
            return;
        }
        if (url.pathname === '/api/search') {
            const q = url.searchParams.get('q') ?? '';
            if (q.trim() === '') {
                json(res, 400, { error: 'q verplicht' });
                return;
            }
            json(res, 200, await zoek(q));
            return;
        }
        json(res, 404, { error: 'onbekend endpoint' });
    } catch (fout) {
        json(res, 502, { error: String(fout.message ?? fout) });
    }
});

server.on('error', (fout) => {
    if (fout.code === 'EADDRINUSE') {
        console.error(
            `Poort ${PORT} is al in gebruik — draait er al een quote-proxy? (of kies een andere poort via QUOTE_PROXY_PORT)`,
        );
        process.exit(1);
    }
    throw fout;
});

server.listen(PORT, () => {
    console.log(`quote-proxy luistert op http://localhost:${PORT}`);
});
