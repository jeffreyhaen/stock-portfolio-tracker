import { CorporateAction, TransactionType } from '../domain/types';

export interface StoredPortfolio {
    id: string;
    name: string;
    reportingCurrency: string;
    createdAt: string;
}

export interface ImportWarningReport {
    rowIndex: number;
    description: string;
    reason: string;
}

export interface ImportReport {
    added: number;
    skippedDuplicates: number;
    rowCount: number;
    unknownTypes: number;
    warnings: ImportWarningReport[];
}

export interface StoredImportBatch {
    id: string;
    portfolioId: string;
    fileName: string;
    importedAt: string;
    rowCount: number;
    report: ImportReport;
}

export interface StoredTransaction {
    id?: number;
    portfolioId: string;
    batchId: string;
    rowIndex: number;
    date: string;
    time: string;
    valueDate: string;
    isin: string | null;
    product: string;
    type: TransactionType;
    corporateAction: CorporateAction | null;
    rawDescription: string;
    quantity: string | null;
    price: string | null;
    currency: string | null;
    mutation: string | null;
    mutationCurrency: string | null;
    balance: string | null;
    balanceCurrency: string | null;
    fxRate: string | null;
    orderId: string | null;
    fingerprint: string;
}

export interface StoredSecurity {
    isin: string;
    name: string;
    tradingCurrency: string | null;
    exchange: string | null;
    quoteTicker: string | null;
}

export interface StoredSecurityAlias {
    oldIsin: string;
    newIsin: string;
    date: string;
    reason: 'split' | 'isin' | 'product';
}

export interface StoredQuote {
    key: string;
    price: string;
    currency: string;
    timestamp: string;
    source?: 'manual' | 'yahoo';
}

export interface StoredFxRate {
    pair: string;
    date: string;
    rate: string;
}

export interface StoredPriceBar {
    isin: string;
    date: string;
    close: string;
    currency: string;
}

export interface StoredSplitEvent {
    isin: string;
    date: string;
    factor: string;
}

export interface StoredSetting {
    key: string;
    value: string;
}

export interface BackupBundle {
    schemaVersion: number;
    appVersion: string;
    exportedAt: string;
    totals: {
        portfolios: number;
        transactions: number;
        securities: number;
        securityAliases: number;
        importBatches: number;
        quoteCache: number;
        fxCache: number;
        priceHistory: number;
        splitEvents: number;
        settings: number;
    };
    data: {
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
    };
}

export interface BackupImportReport {
    schemaVersion: number;
    added: {
        portfolios: number;
        transactions: number;
        securities: number;
        securityAliases: number;
        importBatches: number;
        quoteCache: number;
        fxCache: number;
        priceHistory: number;
        splitEvents: number;
        settings: number;
    };
}

export class BackupError extends Error {
    constructor(
        message: string,
        readonly code: 'unsupported-version' | 'malformed' | 'incompatible',
    ) {
        super(message);
        this.name = 'BackupError';
    }
}
