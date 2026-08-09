import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import { mergeTransactions } from '../domain/dedup';
import { buildLedger } from '../domain/ledger';
import { parseCsv } from '../domain/csv/parse-csv';
import { repairCsvRows } from '../domain/csv/repair-csv-rows';
import { Transaction, TransactionTypes as T } from '../domain/types';
import { PortfolioDatabase } from './db';
import { fromStored, toStored } from './mappers';
import { ImportRapport, StoredImportBatch, StoredSecurity } from './stored-types';

const POSITION_TYPES = new Set<string>([T.TradeBuy, T.TradeSell, T.CorporateBuy, T.CorporateSell]);

@Injectable({ providedIn: 'root' })
export class ImportService {
    private readonly db = inject(PortfolioDatabase);

    async importCsv(portfolioId: string, bestandsnaam: string, csvTekst: string): Promise<ImportRapport> {
        const rows = repairCsvRows(parseCsv(csvTekst).map((row) => row.slice(0, 12)));
        const { transactions, warnings } = buildLedger(rows);

        const existingStored = await this.db.transactions
            .where('[portfolioId+datum]')
            .between([portfolioId, Dexie.minKey], [portfolioId, Dexie.maxKey])
            .toArray();
        const existing = existingStored.map(fromStored);
        const merge = mergeTransactions(existing, transactions);

        const batch: StoredImportBatch = {
            id: crypto.randomUUID(),
            portfolioId,
            bestandsnaam,
            geimporteerdOp: new Date().toISOString(),
            aantalRegels: transactions.length,
            rapport: {
                toegevoegd: merge.added.length,
                overgeslagenDuplicaten: merge.skippedDuplicates,
                aantalRegels: transactions.length,
                onbekendeTypen: merge.added.filter((txn) => txn.type === T.Unknown).length,
                waarschuwingen: warnings.map((warning) => ({
                    regelNr: warning.rowIndex,
                    omschrijving: warning.description,
                    reden: warning.reason,
                })),
            },
        };

        await this.db.transaction('rw', [this.db.transactions, this.db.importBatches, this.db.securities], async () => {
            await this.db.transactions.bulkAdd(merge.added.map((txn) => toStored(txn, portfolioId, batch.id)));
            await this.db.importBatches.add(batch);
            await this.upsertSecurities(merge.added);
        });

        return batch.rapport;
    }

    async batchesFor(portfolioId: string): Promise<StoredImportBatch[]> {
        const batches = await this.db.importBatches.where('portfolioId').equals(portfolioId).toArray();
        return batches.sort((a, b) => b.geimporteerdOp.localeCompare(a.geimporteerdOp));
    }

    private async upsertSecurities(added: readonly Transaction[]): Promise<void> {
        const seen = new Map<string, StoredSecurity>();
        for (const txn of added) {
            if (!POSITION_TYPES.has(txn.type) || txn.isin === null || txn.product.trim() === '') {
                continue;
            }
            seen.set(txn.isin, {
                isin: txn.isin,
                naam: txn.product,
                handelsvaluta: txn.tradeCurrency,
                beurs: null,
                tickerVoorKoers: null,
            });
        }
        for (const security of seen.values()) {
            const bestaand = await this.db.securities.get(security.isin);
            if (bestaand === undefined) {
                await this.db.securities.add(security);
            } else if (bestaand.naam !== security.naam || bestaand.handelsvaluta !== security.handelsvaluta) {
                await this.db.securities.put({
                    ...security,
                    beurs: bestaand.beurs,
                    tickerVoorKoers: bestaand.tickerVoorKoers,
                });
            }
        }
    }
}
