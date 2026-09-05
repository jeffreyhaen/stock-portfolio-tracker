import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import Dexie, { DexieOptions, Table } from 'dexie';
import {
    StoredFxRate,
    StoredImportBatch,
    StoredPortfolio,
    StoredPriceBar,
    StoredProjectionModel,
    StoredProjectionSnapshot,
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
    projectionModels!: Table<StoredProjectionModel, string>;
    projectionSnapshots!: Table<StoredProjectionSnapshot, number>;

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
        this.version(4)
            .stores({
                portfolios: 'id',
                importBatches: 'id, portfolioId',
                transactions: '++id, [portfolioId+date], fingerprint',
                securities: 'isin',
                securityAliases: 'oudIsin, nieuwIsin',
                securityAliasesMigration: 'oldIsin, newIsin',
                quoteCache: 'sleutel',
                quoteCacheMigration: 'key',
                fxCache: '[paar+datum]',
                fxCacheMigration: '[pair+date]',
                priceHistory: '[isin+datum], isin',
                priceHistoryMigration: '[isin+date], isin',
                splitEvents: '[isin+datum]',
                splitEventsMigration: '[isin+date]',
                settings: 'sleutel',
                settingsMigration: 'key',
            })
            .upgrade(async (transaction) => {
                await Promise.all([
                    transaction
                        .table('portfolios')
                        .toCollection()
                        .modify((row) => {
                            rename(row, 'name', 'naam');
                            rename(row, 'reportingCurrency', 'rapportagevaluta');
                            rename(row, 'createdAt', 'aangemaaktOp');
                        }),
                    transaction
                        .table('importBatches')
                        .toCollection()
                        .modify((row) => {
                            rename(row, 'fileName', 'bestandsnaam');
                            rename(row, 'importedAt', 'geimporteerdOp');
                            rename(row, 'rowCount', 'aantalRegels');
                            rename(row, 'report', 'rapport');
                            if (row['report'] !== undefined) {
                                normalizeReport(row['report']);
                            }
                        }),
                    transaction
                        .table('transactions')
                        .toCollection()
                        .modify((row) => {
                            rename(row, 'rowIndex', 'regelNr');
                            rename(row, 'date', 'datum');
                            rename(row, 'time', 'tijd');
                            rename(row, 'valueDate', 'valutadatum');
                            rename(row, 'corporateAction', 'corporateActie');
                            rename(row, 'rawDescription', 'omschrijvingRaw');
                            rename(row, 'quantity', 'aantal');
                            rename(row, 'price', 'prijs');
                            rename(row, 'currency', 'valuta');
                            rename(row, 'mutation', 'mutatie');
                            rename(row, 'mutationCurrency', 'mutatieValuta');
                            rename(row, 'balance', 'saldo');
                            rename(row, 'balanceCurrency', 'saldoValuta');
                            rename(row, 'fxRate', 'fxKoers');
                            normalizeCorporateAction(row);
                        }),
                    transaction
                        .table('securities')
                        .toCollection()
                        .modify((row) => {
                            rename(row, 'name', 'naam');
                            rename(row, 'tradingCurrency', 'handelsvaluta');
                            rename(row, 'exchange', 'beurs');
                            rename(row, 'quoteTicker', 'tickerVoorKoers');
                        }),
                    transaction
                        .table('securityAliases')
                        .toCollection()
                        .modify((row) => {
                            if (row['oldIsin'] === undefined && row['oudIsin'] !== undefined) {
                                row['oldIsin'] = row['oudIsin'];
                            }
                            if (row['newIsin'] === undefined && row['nieuwIsin'] !== undefined) {
                                row['newIsin'] = row['nieuwIsin'];
                            }
                            rename(row, 'date', 'datum');
                            rename(row, 'reason', 'reden');
                        }),
                    transaction
                        .table('quoteCache')
                        .toCollection()
                        .modify((row) => {
                            if (row['key'] === undefined && row['sleutel'] !== undefined) {
                                row['key'] = row['sleutel'];
                            }
                            rename(row, 'price', 'prijs');
                            rename(row, 'currency', 'valuta');
                            rename(row, 'timestamp', 'tijdstip');
                            rename(row, 'source', 'bron');
                        }),
                    transaction
                        .table('fxCache')
                        .toCollection()
                        .modify((row) => {
                            if (row['pair'] === undefined && row['paar'] !== undefined) {
                                row['pair'] = row['paar'];
                            }
                            if (row['date'] === undefined && row['datum'] !== undefined) {
                                row['date'] = row['datum'];
                            }
                            rename(row, 'rate', 'koers');
                        }),
                    transaction
                        .table('priceHistory')
                        .toCollection()
                        .modify((row) => {
                            if (row['date'] === undefined && row['datum'] !== undefined) {
                                row['date'] = row['datum'];
                            }
                            rename(row, 'close', 'slotkoers');
                            rename(row, 'currency', 'valuta');
                        }),
                    transaction
                        .table('splitEvents')
                        .toCollection()
                        .modify((row) => {
                            if (row['date'] === undefined && row['datum'] !== undefined) {
                                row['date'] = row['datum'];
                            }
                        }),
                    transaction
                        .table('settings')
                        .toCollection()
                        .modify((row) => {
                            if (row['key'] === undefined && row['sleutel'] !== undefined) {
                                row['key'] = row['sleutel'];
                            }
                            rename(row, 'value', 'waarde');
                        }),
                ]);

                const aliases = await transaction.table('securityAliases').toArray();
                const quotes = await transaction.table('quoteCache').toArray();
                const fxRates = await transaction.table('fxCache').toArray();
                const priceBars = await transaction.table('priceHistory').toArray();
                const splits = await transaction.table('splitEvents').toArray();
                const settings = await transaction.table('settings').toArray();
                await transaction
                    .table('securityAliasesMigration')
                    .bulkPut(aliases.map((row) => withoutLegacyKeys(row, 'oudIsin', 'nieuwIsin')));
                await transaction
                    .table('quoteCacheMigration')
                    .bulkPut(quotes.map((row) => withoutLegacyKeys(row, 'sleutel')));
                await transaction
                    .table('fxCacheMigration')
                    .bulkPut(fxRates.map((row) => withoutLegacyKeys(row, 'paar', 'datum')));
                await transaction
                    .table('priceHistoryMigration')
                    .bulkPut(priceBars.map((row) => withoutLegacyKeys(row, 'datum')));
                await transaction
                    .table('splitEventsMigration')
                    .bulkPut(splits.map((row) => withoutLegacyKeys(row, 'datum')));
                await transaction
                    .table('settingsMigration')
                    .bulkPut(settings.map((row) => withoutLegacyKeys(row, 'sleutel')));
            });
        this.version(5).stores({
            securityAliases: null,
            quoteCache: null,
            fxCache: null,
            priceHistory: null,
            splitEvents: null,
            settings: null,
        });
        this.version(6)
            .stores({
                securityAliases: 'oldIsin, newIsin',
                quoteCache: 'key',
                fxCache: '[pair+date]',
                priceHistory: '[isin+date], isin',
                splitEvents: '[isin+date]',
                settings: 'key',
            })
            .upgrade(async (transaction) => {
                const aliases = await transaction.table('securityAliasesMigration').toArray();
                const quotes = await transaction.table('quoteCacheMigration').toArray();
                const fxRates = await transaction.table('fxCacheMigration').toArray();
                const priceBars = await transaction.table('priceHistoryMigration').toArray();
                const splits = await transaction.table('splitEventsMigration').toArray();
                const settings = await transaction.table('settingsMigration').toArray();
                await transaction.table('securityAliases').bulkPut(aliases);
                await transaction.table('quoteCache').bulkPut(quotes);
                await transaction.table('fxCache').bulkPut(fxRates);
                await transaction.table('priceHistory').bulkPut(priceBars);
                await transaction.table('splitEvents').bulkPut(splits);
                await transaction.table('settings').bulkPut(settings);
            });
        this.version(7).stores({
            securityAliasesMigration: null,
            quoteCacheMigration: null,
            fxCacheMigration: null,
            priceHistoryMigration: null,
            splitEventsMigration: null,
            settingsMigration: null,
        });
        this.version(8).upgrade((transaction) =>
            transaction
                .table('portfolios')
                .toCollection()
                .modify((row) => {
                    row['lotStrategy'] = 'fifo';
                }),
        );
        this.version(9).stores({
            projectionModels: 'symbol',
            projectionSnapshots: '++id, symbol',
        });
        this.version(10).upgrade((transaction) =>
            transaction
                .table('projectionModels')
                .toCollection()
                .modify((row) => {
                    row['currency'] = row['currency'] ?? '';
                }),
        );
    }
}

type MutableRecord = Record<string, unknown>;

function rename(row: MutableRecord, current: string, legacy: string): void {
    if (row[current] === undefined && row[legacy] !== undefined) {
        row[current] = row[legacy];
    }
    delete row[legacy];
}

function withoutLegacyKeys(row: MutableRecord, ...keys: string[]): MutableRecord {
    const copy = { ...row };
    for (const key of keys) {
        delete copy[key];
    }
    return copy;
}

function normalizeReport(report: MutableRecord): void {
    rename(report, 'added', 'toegevoegd');
    rename(report, 'skippedDuplicates', 'overgeslagenDuplicaten');
    rename(report, 'rowCount', 'aantalRegels');
    rename(report, 'unknownTypes', 'onbekendeTypen');
    rename(report, 'warnings', 'waarschuwingen');
    if (Array.isArray(report['warnings'])) {
        for (const warning of report['warnings']) {
            if (typeof warning === 'object' && warning !== null) {
                const row = warning as MutableRecord;
                rename(row, 'rowIndex', 'regelNr');
                rename(row, 'description', 'omschrijving');
                rename(row, 'reason', 'reden');
            }
        }
    }
}

function normalizeCorporateAction(row: MutableRecord): void {
    if (row['corporateAction'] === 'PRODUCTWIJZIGING') {
        row['corporateAction'] = 'PRODUCT_CHANGE';
    } else if (row['corporateAction'] === 'WIJZIGING_ISIN') {
        row['corporateAction'] = 'ISIN_CHANGE';
    }
}

export function providePortfolioDatabase(): EnvironmentProviders {
    return makeEnvironmentProviders([{ provide: PortfolioDatabase, useFactory: () => new PortfolioDatabase() }]);
}
