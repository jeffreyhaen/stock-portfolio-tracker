import { CorporateAction, TransactionType } from '../domain/types';

export interface StoredPortfolio {
    id: string;
    naam: string;
    rapportagevaluta: string;
    aangemaaktOp: string;
}

export interface ImportWarningReport {
    regelNr: number;
    omschrijving: string;
    reden: string;
}

export interface ImportRapport {
    toegevoegd: number;
    overgeslagenDuplicaten: number;
    aantalRegels: number;
    onbekendeTypen: number;
    waarschuwingen: ImportWarningReport[];
}

export interface StoredImportBatch {
    id: string;
    portfolioId: string;
    bestandsnaam: string;
    geimporteerdOp: string;
    aantalRegels: number;
    rapport: ImportRapport;
}

export interface StoredTransaction {
    id?: number;
    portfolioId: string;
    batchId: string;
    regelNr: number;
    datum: string;
    tijd: string;
    valutadatum: string;
    isin: string | null;
    product: string;
    type: TransactionType;
    corporateActie: CorporateAction | null;
    omschrijvingRaw: string;
    aantal: string | null;
    prijs: string | null;
    valuta: string | null;
    mutatie: string | null;
    mutatieValuta: string | null;
    saldo: string | null;
    saldoValuta: string | null;
    fxKoers: string | null;
    orderId: string | null;
    fingerprint: string;
}

export interface StoredSecurity {
    isin: string;
    naam: string;
    handelsvaluta: string | null;
    beurs: string | null;
    tickerVoorKoers: string | null;
}

export interface StoredSecurityAlias {
    oudIsin: string;
    nieuwIsin: string;
    datum: string;
    reden: 'split' | 'isin' | 'product';
}

export interface StoredQuote {
    sleutel: string;
    prijs: string;
    valuta: string;
    tijdstip: string;
    bron?: 'manual' | 'yahoo';
}

export interface StoredFxRate {
    paar: string;
    datum: string;
    koers: string;
}

export interface StoredPriceBar {
    isin: string;
    datum: string;
    slotkoers: string;
    valuta: string;
}

export interface StoredSplitEvent {
    isin: string;
    datum: string;
    factor: string;
}

export interface StoredSetting {
    sleutel: string;
    waarde: string;
}
