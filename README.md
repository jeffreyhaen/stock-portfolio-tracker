# StockPortfolioApp

A client-side Angular application for tracking an investment portfolio from DEGIRO CSV exports.

## Features

- Import and reconcile DEGIRO transactions
- Holdings, cash, transactions, valuation, return, and market-value history
- Multiple portfolios
- Local JSON backup and restore
- Optional live quotes and historical prices through the local quote proxy

Portfolio data is stored in the browser's IndexedDB. The application has no backend and does not upload imported portfolio data to this repository or to an application server.

## Requirements

- Node.js 24 or newer
- npm 11 or newer

## Development

```bash
npm ci
npm start
```

Open `http://localhost:4200/`.

A synthetic DEGIRO import file is available at [examples/demo/degiro-demo.csv](examples/demo/degiro-demo.csv). It contains fictional transactions from January 2020 through March 2025 for well-known large-cap stocks and ETFs; it does not contain personal portfolio data. When re-importing an updated demo file, use a fresh portfolio because imports are incremental.

Live quotes require the local proxy in a second terminal:

```bash
npm run quotes
```

The proxy retrieves quote data from Yahoo Finance and listens on `http://localhost:8787` by default. Foreign-exchange rates are retrieved from Frankfurter. Review the terms and availability of these external services before relying on the data.

## Verification

```bash
npm test
npm run lint
npm run build
```

## Privacy and limitations

- Imported CSV files and exported backups can contain sensitive financial information. Keep them local and do not commit them.
- This application is a portfolio tracking tool, not financial advice.
- Quote and foreign-exchange data may be delayed, incomplete, or unavailable.
- The quote proxy is intended for local development. Do not expose it to the public internet without adding suitable authentication, rate limiting, and operational controls.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
