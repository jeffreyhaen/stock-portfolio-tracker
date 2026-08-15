import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import { mergeTransactions } from '../domain/dedup';
import { buildLedger } from '../domain/ledger';
import { parseCsv } from '../domain/csv/parse-csv';
import { repairCsvRows } from '../domain/csv/repair-csv-rows';
import { Transaction, TransactionTypes as T } from '../domain/types';
import { PortfolioDatabase } from './db';
import { fromStored, toStored } from './mappers';
import { ImportReport, StoredImportBatch, StoredSecurity } from './stored-types';

const POSITION_TYPES = new Set<string>([T.TradeBuy, T.TradeSell, T.CorporateBuy, T.CorporateSell]);

@Injectable({ providedIn: 'root' })
export class ImportService {
    private readonly db = inject(PortfolioDatabase);

    async importCsv(portfolioId: string, fileName: string, csvText: string): Promise<ImportReport> {
        const rows = repairCsvRows(parseCsv(csvText).map((row) => row.slice(0, 12)));
        const { transactions, warnings } = buildLedger(rows);

        const existingStored = await this.db.transactions
            .where('[portfolioId+date]')
            .between([portfolioId, Dexie.minKey], [portfolioId, Dexie.maxKey])
            .toArray();
        const existing = existingStored.map(fromStored);
        const merge = mergeTransactions(existing, transactions);

        const batch: StoredImportBatch = {
            id: crypto.randomUUID(),
            portfolioId,
            fileName,
            importedAt: new Date().toISOString(),
            rowCount: transactions.length,
            report: {
                added: merge.added.length,
                skippedDuplicates: merge.skippedDuplicates,
                rowCount: transactions.length,
                unknownTypes: merge.added.filter((txn) => txn.type === T.Unknown).length,
                warnings: warnings.map((warning) => ({
                    rowIndex: warning.rowIndex,
                    description: warning.description,
                    reason: warning.reason,
                })),
            },
        };

        await this.db.transaction('rw', [this.db.transactions, this.db.importBatches, this.db.securities], async () => {
            await this.db.transactions.bulkAdd(merge.added.map((txn) => toStored(txn, portfolioId, batch.id)));
            await this.db.importBatches.add(batch);
            await this.upsertSecurities(merge.added);
        });

        return batch.report;
    }

    async batchesFor(portfolioId: string): Promise<StoredImportBatch[]> {
        const batches = await this.db.importBatches.where('portfolioId').equals(portfolioId).toArray();
        return batches.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    }

    private async upsertSecurities(added: readonly Transaction[]): Promise<void> {
        const seen = new Map<string, StoredSecurity>();
        for (const txn of added) {
            if (!POSITION_TYPES.has(txn.type) || txn.isin === null || txn.product.trim() === '') {
                continue;
            }
            seen.set(txn.isin, {
                isin: txn.isin,
                name: txn.product,
                tradingCurrency: txn.tradeCurrency,
                exchange: null,
                quoteTicker: null,
            });
        }
        for (const security of seen.values()) {
            const existing = await this.db.securities.get(security.isin);
            if (existing === undefined) {
                await this.db.securities.add(security);
            } else if (existing.name !== security.name || existing.tradingCurrency !== security.tradingCurrency) {
                await this.db.securities.put({
                    ...security,
                    exchange: existing.exchange,
                    quoteTicker: existing.quoteTicker,
                });
            }
        }
    }
}
