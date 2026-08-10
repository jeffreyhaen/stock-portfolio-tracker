# quote-proxy

Lokaal proxytje voor koersdata (milestone M5). Draait op poort 8787, praat alleen
met allowlisted Yahoo-hosts (geen open proxy), en levert:

- `GET /api/search?q=...` → ticker-suggesties `[{ symbol, name, exchange }]`
- `GET /api/quote?symbols=A,B` → laatste koersen `{ symbol: { price, currency, time } }`
- `GET /api/history?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD` → dagkoersen `[{ date, close }]`

Starten:

```bash
node tools/quote-proxy/server.js
# of: npm run quotes
```

In-memory cache: quotes 15 minuten, historie blijvend (dagkoersen veranderen niet).
