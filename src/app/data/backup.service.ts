import { inject, Injectable } from '@angular/core';
import {
    BackupBundle,
    BackupError,
    BackupImportReport,
    ImportReport,
    ImportWarningReport,
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
import { PortfolioDatabase } from './db';

export const CURRENT_SCHEMA_VERSION = 4;
export const APP_VERSION = '0.0.0';

export interface BackupStores {
    portfolios: StoredPortfolio[];
    transactions: StoredTransaction[];
    securities: StoredSecurity[];
    securityAliases: StoredSecurityAlias[];
    importBatches: StoredImportBatch[];
    quoteCache: StoredQuote[];
    fxCache: StoredFxRate[];
    priceHistory: StoredPriceBar[];
    splitEvents: StoredSplitEvent[];
    settings: StoredSetting[];
}

export interface DbSnapshot {
    portfolios: readonly StoredPortfolio[];
    transactions: readonly StoredTransaction[];
    securities: readonly StoredSecurity[];
    securityAliases: readonly StoredSecurityAlias[];
    importBatches: readonly StoredImportBatch[];
    quoteCache: readonly StoredQuote[];
    fxCache: readonly StoredFxRate[];
    priceHistory: readonly StoredPriceBar[];
    splitEvents: readonly StoredSplitEvent[];
    settings: readonly StoredSetting[];
}

@Injectable({ providedIn: 'root' })
export class BackupService {
    private readonly db = inject(PortfolioDatabase);

    async export(): Promise<BackupBundle> {
        const snapshot = await this.readSnapshot();
        return bundleFromSnapshot(snapshot);
    }

    async import(bundle: BackupBundle): Promise<BackupImportReport> {
        const normalized = normalizeBundle(bundle);
        validateBundle(normalized);
        const data = normalized.data;
        await this.db.transaction(
            'rw',
            [
                this.db.portfolios,
                this.db.transactions,
                this.db.securities,
                this.db.securityAliases,
                this.db.importBatches,
                this.db.quoteCache,
                this.db.fxCache,
                this.db.priceHistory,
                this.db.splitEvents,
                this.db.settings,
            ],
            async () => {
                await this.db.portfolios.clear();
                await this.db.transactions.clear();
                await this.db.securities.clear();
                await this.db.securityAliases.clear();
                await this.db.importBatches.clear();
                await this.db.quoteCache.clear();
                await this.db.fxCache.clear();
                await this.db.priceHistory.clear();
                await this.db.splitEvents.clear();
                await this.db.settings.clear();

                if (data.portfolios.length > 0) await this.db.portfolios.bulkPut(data.portfolios);
                if (data.transactions.length > 0) await this.db.transactions.bulkPut(data.transactions);
                if (data.securities.length > 0) await this.db.securities.bulkPut(data.securities);
                if (data.securityAliases.length > 0) await this.db.securityAliases.bulkPut(data.securityAliases);
                if (data.importBatches.length > 0) await this.db.importBatches.bulkPut(data.importBatches);
                if (data.quoteCache.length > 0) await this.db.quoteCache.bulkPut(data.quoteCache);
                if (data.fxCache.length > 0) await this.db.fxCache.bulkPut(data.fxCache);
                if (data.priceHistory.length > 0) await this.db.priceHistory.bulkPut(data.priceHistory);
                if (data.splitEvents.length > 0) await this.db.splitEvents.bulkPut(data.splitEvents);
                if (data.settings.length > 0) await this.db.settings.bulkPut(data.settings);
            },
        );
        return importReport(normalized);
    }

    private async readSnapshot(): Promise<DbSnapshot> {
        const [
            portfolios,
            transactions,
            securities,
            securityAliases,
            importBatches,
            quoteCache,
            fxCache,
            priceHistory,
            splitEvents,
            settings,
        ] = await Promise.all([
            this.db.portfolios.toArray(),
            this.db.transactions.toArray(),
            this.db.securities.toArray(),
            this.db.securityAliases.toArray(),
            this.db.importBatches.toArray(),
            this.db.quoteCache.toArray(),
            this.db.fxCache.toArray(),
            this.db.priceHistory.toArray(),
            this.db.splitEvents.toArray(),
            this.db.settings.toArray(),
        ]);
        return {
            portfolios,
            transactions,
            securities,
            securityAliases,
            importBatches,
            quoteCache,
            fxCache,
            priceHistory,
            splitEvents,
            settings,
        };
    }
}

export function bundleFromSnapshot(snapshot: DbSnapshot): BackupBundle {
    const data: BackupStores = {
        portfolios: [...snapshot.portfolios],
        transactions: [...snapshot.transactions],
        securities: [...snapshot.securities],
        securityAliases: [...snapshot.securityAliases],
        importBatches: [...snapshot.importBatches],
        quoteCache: [...snapshot.quoteCache],
        fxCache: [...snapshot.fxCache],
        priceHistory: [...snapshot.priceHistory],
        splitEvents: [...snapshot.splitEvents],
        settings: [...snapshot.settings],
    };
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: APP_VERSION,
        exportedAt: new Date().toISOString(),
        totals: totalsFor(data),
        data,
    };
}

export function validateBundle(input: unknown): asserts input is BackupBundle {
    if (input === null || typeof input !== 'object') {
        throw new BackupError('The backup is not a JSON object.', 'malformed');
    }
    const bundle = input as Partial<BackupBundle>;
    if (typeof bundle.schemaVersion !== 'number') {
        throw new BackupError('The backup has no schemaVersion.', 'malformed');
    }
    if (bundle.schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new BackupError(
            `The backup uses a newer schema version (${bundle.schemaVersion}). This app supports up to schema ${CURRENT_SCHEMA_VERSION}.`,
            'unsupported-version',
        );
    }
    if (bundle.schemaVersion < 1) {
        throw new BackupError('The backup has an invalid schemaVersion.', 'incompatible');
    }
    if (bundle.data === null || typeof bundle.data !== 'object') {
        throw new BackupError('The backup has no data block.', 'malformed');
    }
    const data = bundle.data as Partial<BackupBundle['data']>;
    const requiredStores: (keyof BackupBundle['data'])[] = [
        'portfolios',
        'transactions',
        'securities',
        'securityAliases',
        'importBatches',
        'quoteCache',
        'fxCache',
        'priceHistory',
        'splitEvents',
        'settings',
    ];
    for (const key of requiredStores) {
        if (!Array.isArray(data[key])) {
            throw new BackupError(`The backup has a missing or invalid store: ${key}.`, 'malformed');
        }
    }
}

export function parseBundle(json: string): BackupBundle {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error: unknown) {
        throw new BackupError(
            `The backup is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            'malformed',
        );
    }
    const normalized = normalizeBundle(parsed);
    validateBundle(normalized);
    return normalized;
}

function importReport(bundle: BackupBundle): BackupImportReport {
    return {
        schemaVersion: bundle.schemaVersion,
        added: {
            portfolios: bundle.data.portfolios.length,
            transactions: bundle.data.transactions.length,
            securities: bundle.data.securities.length,
            securityAliases: bundle.data.securityAliases.length,
            importBatches: bundle.data.importBatches.length,
            quoteCache: bundle.data.quoteCache.length,
            fxCache: bundle.data.fxCache.length,
            priceHistory: bundle.data.priceHistory.length,
            splitEvents: bundle.data.splitEvents.length,
            settings: bundle.data.settings.length,
        },
    };
}

type UnknownRecord = Record<string, unknown>;

function normalizeBundle(input: unknown): BackupBundle {
    if (input === null || typeof input !== 'object') {
        return input as BackupBundle;
    }
    const source = input as UnknownRecord;
    const data = source['data'];
    if (
        typeof source['schemaVersion'] !== 'number' ||
        source['schemaVersion'] < 1 ||
        source['schemaVersion'] >= CURRENT_SCHEMA_VERSION ||
        data === null ||
        typeof data !== 'object'
    ) {
        return input as BackupBundle;
    }
    const raw = data as UnknownRecord;
    const requiredStores = [
        'portfolios',
        'transactions',
        'securities',
        'securityAliases',
        'importBatches',
        'quoteCache',
        'fxCache',
        'priceHistory',
        'splitEvents',
        'settings',
    ];
    if (!requiredStores.every((key) => Array.isArray(raw[key]))) {
        return input as BackupBundle;
    }
    const normalizedData: BackupStores = {
        portfolios: array(raw['portfolios']).map(normalizePortfolio),
        transactions: array(raw['transactions']).map(normalizeTransaction),
        securities: array(raw['securities']).map(normalizeSecurity),
        securityAliases: array(raw['securityAliases']).map(normalizeSecurityAlias),
        importBatches: array(raw['importBatches']).map(normalizeImportBatch),
        quoteCache: array(raw['quoteCache']).map(normalizeQuote),
        fxCache: array(raw['fxCache']).map(normalizeFxRate),
        priceHistory: array(raw['priceHistory']).map(normalizePriceBar),
        splitEvents: array(raw['splitEvents']).map(normalizeSplitEvent),
        settings: array(raw['settings']).map(normalizeSetting),
    };
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: stringValue(source['appVersion']) ?? APP_VERSION,
        exportedAt: stringValue(source['exportedAt']) ?? new Date(0).toISOString(),
        totals: totalsFor(normalizedData),
        data: normalizedData,
    };
}

function array(value: unknown): UnknownRecord[] {
    return Array.isArray(value)
        ? value.filter((item): item is UnknownRecord => item !== null && typeof item === 'object')
        : [];
}

function value(row: UnknownRecord, current: string, legacy: string): unknown {
    return row[current] ?? row[legacy];
}

function stringValue(input: unknown): string | undefined {
    return typeof input === 'string' ? input : undefined;
}

function nullableString(row: UnknownRecord, current: string, legacy: string): string | null {
    const item = value(row, current, legacy);
    return item === null || item === undefined ? null : String(item);
}

function normalizePortfolio(row: UnknownRecord): StoredPortfolio {
    return {
        id: String(row['id']),
        name: String(value(row, 'name', 'naam') ?? ''),
        reportingCurrency: String(value(row, 'reportingCurrency', 'rapportagevaluta') ?? 'EUR'),
        createdAt: String(value(row, 'createdAt', 'aangemaaktOp') ?? new Date(0).toISOString()),
    };
}

function normalizeImportBatch(row: UnknownRecord): StoredImportBatch {
    const report = value(row, 'report', 'rapport');
    return {
        id: String(row['id']),
        portfolioId: String(row['portfolioId']),
        fileName: String(value(row, 'fileName', 'bestandsnaam') ?? ''),
        importedAt: String(value(row, 'importedAt', 'geimporteerdOp') ?? new Date(0).toISOString()),
        rowCount: Number(value(row, 'rowCount', 'aantalRegels') ?? 0),
        report: normalizeReport(report),
    };
}

function normalizeReport(input: unknown): ImportReport {
    const row = input !== null && typeof input === 'object' ? (input as UnknownRecord) : {};
    const warnings = value(row, 'warnings', 'waarschuwingen');
    return {
        added: Number(value(row, 'added', 'toegevoegd') ?? 0),
        skippedDuplicates: Number(value(row, 'skippedDuplicates', 'overgeslagenDuplicaten') ?? 0),
        rowCount: Number(value(row, 'rowCount', 'aantalRegels') ?? 0),
        unknownTypes: Number(value(row, 'unknownTypes', 'onbekendeTypen') ?? 0),
        warnings: array(warnings).map(normalizeWarning),
    };
}

function normalizeWarning(row: UnknownRecord): ImportWarningReport {
    return {
        rowIndex: Number(value(row, 'rowIndex', 'regelNr') ?? 0),
        description: String(value(row, 'description', 'omschrijving') ?? ''),
        reason: String(value(row, 'reason', 'reden') ?? ''),
    };
}

function normalizeTransaction(row: UnknownRecord): StoredTransaction {
    const action = value(row, 'corporateAction', 'corporateActie');
    return {
        ...(row['id'] === undefined ? {} : { id: Number(row['id']) }),
        portfolioId: String(row['portfolioId']),
        batchId: String(row['batchId']),
        rowIndex: Number(value(row, 'rowIndex', 'regelNr') ?? 0),
        date: String(value(row, 'date', 'datum') ?? ''),
        time: String(value(row, 'time', 'tijd') ?? ''),
        valueDate: String(value(row, 'valueDate', 'valutadatum') ?? ''),
        isin: nullableString(row, 'isin', 'isin'),
        product: String(row['product'] ?? ''),
        type: row['type'] as StoredTransaction['type'],
        corporateAction: normalizeCorporateAction(action),
        rawDescription: String(value(row, 'rawDescription', 'omschrijvingRaw') ?? ''),
        quantity: nullableString(row, 'quantity', 'aantal'),
        price: nullableString(row, 'price', 'prijs'),
        currency: nullableString(row, 'currency', 'valuta'),
        mutation: nullableString(row, 'mutation', 'mutatie'),
        mutationCurrency: nullableString(row, 'mutationCurrency', 'mutatieValuta'),
        balance: nullableString(row, 'balance', 'saldo'),
        balanceCurrency: nullableString(row, 'balanceCurrency', 'saldoValuta'),
        fxRate: nullableString(row, 'fxRate', 'fxKoers'),
        orderId: nullableString(row, 'orderId', 'orderId'),
        fingerprint: String(row['fingerprint'] ?? ''),
    };
}

function normalizeSecurity(row: UnknownRecord): StoredSecurity {
    return {
        isin: String(row['isin']),
        name: String(value(row, 'name', 'naam') ?? ''),
        tradingCurrency: nullableString(row, 'tradingCurrency', 'handelsvaluta'),
        exchange: nullableString(row, 'exchange', 'beurs'),
        quoteTicker: nullableString(row, 'quoteTicker', 'tickerVoorKoers'),
    };
}

function normalizeSecurityAlias(row: UnknownRecord): StoredSecurityAlias {
    return {
        oldIsin: String(value(row, 'oldIsin', 'oudIsin') ?? ''),
        newIsin: String(value(row, 'newIsin', 'nieuwIsin') ?? ''),
        date: String(value(row, 'date', 'datum') ?? ''),
        reason: String(value(row, 'reason', 'reden') ?? '') as StoredSecurityAlias['reason'],
    };
}

function normalizeQuote(row: UnknownRecord): StoredQuote {
    return {
        key: String(value(row, 'key', 'sleutel') ?? ''),
        price: String(value(row, 'price', 'prijs') ?? ''),
        currency: String(value(row, 'currency', 'valuta') ?? ''),
        timestamp: String(value(row, 'timestamp', 'tijdstip') ?? ''),
        ...(row['source'] === undefined && row['bron'] === undefined
            ? {}
            : { source: (value(row, 'source', 'bron') ?? 'manual') as StoredQuote['source'] }),
    };
}

function normalizeFxRate(row: UnknownRecord): StoredFxRate {
    return {
        pair: String(value(row, 'pair', 'paar') ?? ''),
        date: String(value(row, 'date', 'datum') ?? ''),
        rate: String(value(row, 'rate', 'koers') ?? ''),
    };
}

function normalizePriceBar(row: UnknownRecord): StoredPriceBar {
    return {
        isin: String(row['isin']),
        date: String(value(row, 'date', 'datum') ?? ''),
        close: String(value(row, 'close', 'slotkoers') ?? ''),
        currency: String(value(row, 'currency', 'valuta') ?? ''),
    };
}

function normalizeSplitEvent(row: UnknownRecord): StoredSplitEvent {
    return {
        isin: String(row['isin']),
        date: String(value(row, 'date', 'datum') ?? ''),
        factor: String(row['factor'] ?? ''),
    };
}

function normalizeSetting(row: UnknownRecord): StoredSetting {
    return {
        key: String(value(row, 'key', 'sleutel') ?? ''),
        value: String(value(row, 'value', 'waarde') ?? ''),
    };
}

function normalizeCorporateAction(input: unknown): StoredTransaction['corporateAction'] {
    if (input === 'PRODUCTWIJZIGING') return 'PRODUCT_CHANGE';
    if (input === 'WIJZIGING_ISIN') return 'ISIN_CHANGE';
    return (input ?? null) as StoredTransaction['corporateAction'];
}

function totalsFor(data: BackupStores): BackupBundle['totals'] {
    return {
        portfolios: data.portfolios.length,
        transactions: data.transactions.length,
        securities: data.securities.length,
        securityAliases: data.securityAliases.length,
        importBatches: data.importBatches.length,
        quoteCache: data.quoteCache.length,
        fxCache: data.fxCache.length,
        priceHistory: data.priceHistory.length,
        splitEvents: data.splitEvents.length,
        settings: data.settings.length,
    };
}
