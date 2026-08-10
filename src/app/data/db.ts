import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import Dexie, { DexieOptions, Table } from 'dexie';
import {
    StoredFxRate,
    StoredImportBatch,
    StoredPortfolio,
    StoredPriceBar,
    StoredQuote,
    StoredSecurity,
    StoredSecurityAlias,
    StoredSetting,
    StoredSplitEvent,
    StoredTransaction,
} from './stored-types';

export class PortfolioDatabase extends Dexie {
    portfolios!: Table<StoredPortfolio, string>;
    importBatches!: Table<StoredImportBatch, string>;
    transactions!: Table<StoredTransaction, number>;
    securities!: Table<StoredSecurity, string>;
    securityAliases!: Table<StoredSecurityAlias, string>;
    quoteCache!: Table<StoredQuote, string>;
    fxCache!: Table<StoredFxRate, [string, string]>;
    priceHistory!: Table<StoredPriceBar, [string, string]>;
    splitEvents!: Table<StoredSplitEvent, [string, string]>;
    settings!: Table<StoredSetting, string>;

    constructor(options?: DexieOptions) {
        super('stock-portfolio', options);
        this.version(1).stores({
            portfolios: 'id',
            importBatches: 'id, portfolioId',
            transactions: '++id, [portfolioId+datum], fingerprint',
            securities: 'isin',
            securityAliases: 'oudIsin, nieuwIsin',
            quoteCache: 'sleutel',
            fxCache: '[paar+datum]',
            settings: 'sleutel',
        });
        this.version(2).stores({
            priceHistory: '[isin+datum], isin',
        });
        this.version(3).stores({
            splitEvents: '[isin+datum]',
        });
    }
}

export function providePortfolioDatabase(): EnvironmentProviders {
    return makeEnvironmentProviders([{ provide: PortfolioDatabase, useFactory: () => new PortfolioDatabase() }]);
}
