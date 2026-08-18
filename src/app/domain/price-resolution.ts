import Decimal from 'decimal.js';
import { groupCorporateActions } from './corporate-action-grouping';
import { Transaction, TransactionTypes as T } from './types';

export type PriceProvenance = 'live' | 'market' | 'manual' | 'cache' | 'trade';

export interface PriceQuote {
    readonly price: Decimal;
    readonly currency: string;
    readonly date?: string;
    readonly source?: Exclude<PriceProvenance, 'trade'>;
    readonly stale?: boolean;
}

export interface ResolvedPrice {
    readonly price: Decimal;
    readonly currency: string;
    readonly date: string | null;
    readonly provenance: PriceProvenance;
    readonly stale: boolean;
    readonly estimated: boolean;
    readonly transactionFxRate: Decimal | null;
}

export type PriceResolver = (isin: string, date: string) => ResolvedPrice | null;

interface TradePrice {
    readonly date: string;
    readonly time: string;
    readonly rowIndex: number;
    readonly price: Decimal;
    readonly currency: string;
    readonly fxRate: Decimal | null;
}

interface CorporateGroup {
    readonly rows: Transaction[];
    readonly date: string;
    readonly time: string;
    readonly rowIndex: number;
    readonly key: string;
}

function comparePoint(
    a: Pick<TradePrice, 'date' | 'time' | 'rowIndex'>,
    b: Pick<TradePrice, 'date' | 'time' | 'rowIndex'>,
): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex;
}

export function buildPriceResolver(
    transactions: readonly Transaction[],
    quotes: ReadonlyMap<string, PriceQuote>,
): PriceResolver {
    const trades = new Map<string, TradePrice[]>();
    for (const txn of transactions) {
        if (
            txn.isin === null ||
            (txn.type !== T.TradeBuy && txn.type !== T.TradeSell) ||
            txn.price === null ||
            !txn.price.isFinite() ||
            !txn.price.gt(0) ||
            txn.tradeCurrency === null ||
            txn.tradeCurrency === ''
        ) {
            continue;
        }
        const list = trades.get(txn.isin) ?? [];
        list.push({
            date: txn.date,
            time: txn.time,
            rowIndex: txn.rowIndex,
            price: txn.price,
            currency: txn.tradeCurrency,
            fxRate: txn.fxRate,
        });
        trades.set(txn.isin, list);
    }
    for (const list of trades.values()) {
        list.sort(comparePoint);
    }

    const groups: CorporateGroup[] = groupCorporateActions(transactions).flatMap((group, index) => {
        const rows = group.rows.filter(
            (txn) =>
                txn.corporateAction !== 'SPIN_OFF' &&
                txn.isin !== null &&
                txn.quantity !== null &&
                txn.quantity.isFinite() &&
                txn.quantity.gt(0),
        );
        const last = rows[rows.length - 1];
        return last === undefined
            ? []
            : [{ rows, date: last.date, time: last.time, rowIndex: last.rowIndex, key: `group:${index}` }];
    });
    groups.sort((a, b) => comparePoint(a, b) || a.key.localeCompare(b.key));

    for (const group of groups) {
        const sells = group.rows.filter((txn) => txn.type === T.CorporateSell);
        const buys = group.rows.filter((txn) => txn.type === T.CorporateBuy);
        const sourceIsins = new Set(sells.map((txn) => txn.isin as string));
        const targetIsins = new Set(buys.map((txn) => txn.isin as string));
        if (sells.length === 0 || buys.length === 0 || sourceIsins.size !== 1 || targetIsins.size !== 1) continue;
        const oldQuantity = sells.reduce((sum, txn) => sum.plus(txn.quantity as Decimal), new Decimal(0));
        const newQuantity = buys.reduce((sum, txn) => sum.plus(txn.quantity as Decimal), new Decimal(0));
        if (!oldQuantity.gt(0) || !newQuantity.gt(0)) continue;
        const sourceIsin = [...sourceIsins][0];
        const targetIsin = [...targetIsins][0];
        let inherited: TradePrice | null = null;
        for (const anchor of trades.get(sourceIsin) ?? []) {
            if (comparePoint(anchor, group) > 0) break;
            inherited = anchor;
        }
        if (inherited === null) continue;
        const target = trades.get(targetIsin) ?? [];
        target.push({
            date: group.date,
            time: group.time,
            rowIndex: group.rowIndex,
            price: inherited.price.times(oldQuantity).div(newQuantity),
            currency: inherited.currency,
            fxRate: inherited.fxRate,
        });
        target.sort(comparePoint);
        trades.set(targetIsin, target);
    }

    return (isin, date) => {
        const quote = quotes.get(isin);
        if (
            quote !== undefined &&
            quote.price.isFinite() &&
            quote.price.gt(0) &&
            (quote.date === undefined || quote.date <= date)
        ) {
            return {
                price: quote.price,
                currency: quote.currency,
                date: quote.date ?? null,
                provenance: quote.source ?? 'market',
                stale: quote.stale ?? false,
                estimated: false,
                transactionFxRate: null,
            };
        }
        const list = trades.get(isin) ?? [];
        let found: TradePrice | null = null;
        for (const trade of list) {
            if (trade.date > date) break;
            found = trade;
        }
        return found === null
            ? null
            : {
                  price: found.price,
                  currency: found.currency,
                  date: found.date,
                  provenance: 'trade',
                  stale: found.date < date,
                  estimated: true,
                  transactionFxRate: found.fxRate,
              };
    };
}
