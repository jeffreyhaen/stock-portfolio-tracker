# market-data-proxy

Experimental, local-development-only market-data proxy. Runs on
port 8787, only talks to allowlisted Yahoo hosts (no open proxy), and serves:

- `GET /api/search?q=...` → ticker suggestions `[{ symbol, name, exchange }]`
- `GET /api/quote?symbols=A,B` → latest quotes `{ symbol: { price, currency, time } }`
- `GET /api/history?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ currency, bars: [{ date, close }], splits: [{ date, factor }] }`
- `GET /api/health` → `{ ok: true }`

Start:

```bash
node tools/market-data-proxy/server.js
# or: npm run market-data-proxy
```

In-memory cache: quotes and search results 15 minutes; history stays cached for the lifetime of the process.

This proxy uses unofficial Yahoo Finance endpoints. Do not deploy or expose it
as a public or commercial service without confirming the applicable provider
terms and adding suitable authentication, rate limiting, and operational controls.
