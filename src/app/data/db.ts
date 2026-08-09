import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import Dexie, { DexieOptions, Table } from 'dexie';
import {
    StoredFxRate,
    StoredImportBatch,
    StoredPortfolio,
    StoredQuote,
    StoredSecurity,
    StoredSecurityAlias,
    StoredSetting,
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
    }
}

export function providePortfolioDatabase(): EnvironmentProviders {
    return makeEnvironmentProviders([{ provide: PortfolioDatabase, useFactory: () => new PortfolioDatabase() }]);
}
