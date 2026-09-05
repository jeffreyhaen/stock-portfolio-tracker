# market-data-proxy

Experimental, local-development-only market-data proxy. Runs on
port 8787, only talks to allowlisted Yahoo hosts (no open proxy), and serves:

- `GET /api/search?q=...` → ticker suggestions `[{ symbol, name, exchange }]`
- `GET /api/quote?symbols=A,B` → latest quotes `{ symbol: { price, currency, time } }`
- `GET /api/fundamentals?symbol=X` → fundamentals `{ symbol, currency, longName, sharesOutstanding, epsTtm, peTtm, forwardPe, marketCap, priceToSalesTtm, revenueTtm, revenueGrowthTtm, earningsGrowthTtm, marginTtm, grossMargins, fiscalYearEnd, revenueFy, netIncomeFy, netIncomeFyPrev, estimates: { epsGrowthCurrentQtr, epsGrowthCurrentFy, epsGrowthNextFy, revGrowthCurrentFy, revGrowthNextFy, epsEstimateCurrentFy, epsEstimateNextFy, revenueEstimateNextFy } }` (fields are `null` when Yahoo does not report them; `estimates` comes from the `earningsTrend` module and covers the current quarter (0q) and current/next fiscal year (0y/+1y))
- `GET /api/history?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ currency, bars: [{ date, close }], splits: [{ date, factor }] }`
- `GET /api/health` → `{ ok: true }`

Start:

```bash
node tools/market-data-proxy/server.js
# or: npm run market-data-proxy
```

In-memory cache: quotes, search, and fundamentals results 15 minutes; history stays cached for the lifetime of the process. Fundamentals require Yahoo's cookie + crumb handshake, which is cached for 50 minutes and refreshed automatically when Yahoo rejects it.

This proxy uses unofficial Yahoo Finance endpoints. Do not deploy or expose it
as a public or commercial service without confirming the applicable provider
terms and adding suitable authentication, rate limiting, and operational controls.
