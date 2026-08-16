# market-data-proxy

Local market-data proxy (milestone M5). Runs on port 8787, only talks to
allowlisted Yahoo hosts (no open proxy), and serves:

- `GET /api/search?q=...` → ticker suggestions `[{ symbol, name, exchange }]`
- `GET /api/quote?symbols=A,B` → latest quotes `{ symbol: { price, currency, time } }`
- `GET /api/history?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD` → daily prices `[{ date, close }]`

Start:

```bash
node tools/market-data-proxy/server.js
# or: npm run market-data-proxy
```

In-memory cache: quotes 15 minutes, history persistent (daily prices don't change).
