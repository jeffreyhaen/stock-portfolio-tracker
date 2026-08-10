import { inject, Injectable } from '@angular/core';
import {
    BackupBundle,
    BackupError,
    BackupImportReport,
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

export const CURRENT_SCHEMA_VERSION = 3;
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
        const snapshot = await this.leesSnapshot();
        return bundelVanSnapshot(snapshot);
    }

    async import(bundle: BackupBundle): Promise<BackupImportReport> {
        valideerBundle(bundle);
        const data = bundle.data;
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
        return importReport(bundle);
    }

    private async leesSnapshot(): Promise<DbSnapshot> {
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

export function bundelVanSnapshot(snapshot: DbSnapshot): BackupBundle {
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
        totals: {
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
        },
        data,
    };
}

export function valideerBundle(input: unknown): asserts input is BackupBundle {
    if (input === null || typeof input !== 'object') {
        throw new BackupError('Backup-bestand is geen JSON-object.', 'malformed');
    }
    const bundle = input as Partial<BackupBundle>;
    if (typeof bundle.schemaVersion !== 'number') {
        throw new BackupError('Backup-bestand mist schemaVersion.', 'malformed');
    }
    if (bundle.schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new BackupError(
            `Backup-bestand is van een nieuwere versie (schema ${bundle.schemaVersion}). Deze app ondersteunt maximaal schema ${CURRENT_SCHEMA_VERSION}.`,
            'unsupported-version',
        );
    }
    if (bundle.schemaVersion < 1) {
        throw new BackupError('Backup-bestand heeft een ongeldige schemaVersion.', 'incompatible');
    }
    if (bundle.data === null || typeof bundle.data !== 'object') {
        throw new BackupError('Backup-bestand mist data-blok.', 'malformed');
    }
    const data = bundle.data as Partial<BackupBundle['data']>;
    const vereisteStores: (keyof BackupBundle['data'])[] = [
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
    for (const sleutel of vereisteStores) {
        if (!Array.isArray(data[sleutel])) {
            throw new BackupError(`Backup-bestand mist of heeft ongeldige store: ${sleutel}.`, 'malformed');
        }
    }
}

export function parseBundle(json: string): BackupBundle {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (fout: unknown) {
        throw new BackupError(
            `Backup-bestand is geen geldige JSON: ${fout instanceof Error ? fout.message : String(fout)}`,
            'malformed',
        );
    }
    valideerBundle(parsed);
    return parsed;
}

function importReport(bundle: BackupBundle): BackupImportReport {
    return {
        schemaVersion: bundle.schemaVersion,
        toegevoegd: {
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
