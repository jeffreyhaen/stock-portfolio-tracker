import Decimal from 'decimal.js';
import { Transaction, TransactionTypes as T } from './types';

export interface HoldingStats {
    readonly isin: string;
    readonly product: string;
    readonly currency: string;
    readonly quantity: Decimal;
    readonly firstBuyDate: string | null;
    readonly netInvested: Decimal;
    readonly netInvestedPerShare: Decimal;
}

interface PositionAccum {
    product: string;
    currency: string;
    quantity: Decimal;
    cost: Decimal;
    firstBuyDate: string | null;
}

const BUY_TYPES = new Set<string>([T.TradeBuy, T.CorporateBuy]);
const SELL_TYPES = new Set<string>([T.TradeSell, T.CorporateSell]);

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex;
}

export function holdingStats(transactions: readonly Transaction[]): HoldingStats[] {
    const perIsin = new Map<string, PositionAccum>();
    const gesorteerd = [...transactions].sort(compareChronological);
    for (const txn of gesorteerd) {
        if (txn.isin === null || txn.quantity === null) {
            continue;
        }
        const isBuy = BUY_TYPES.has(txn.type);
        const isSell = SELL_TYPES.has(txn.type);
        if (!isBuy && !isSell) {
            continue;
        }
        let accum = perIsin.get(txn.isin);
        if (accum === undefined) {
            accum = {
                product: txn.product,
                currency: txn.mutationCurrency ?? txn.tradeCurrency ?? '',
                quantity: new Decimal(0),
                cost: new Decimal(0),
                firstBuyDate: null,
            };
            perIsin.set(txn.isin, accum);
        }
        if (isBuy) {
            if (accum.quantity.isZero()) {
                accum.firstBuyDate = txn.date;
            }
            accum.quantity = accum.quantity.plus(txn.quantity);
            if (txn.mutation !== null) {
                accum.cost = accum.cost.plus(txn.mutation.abs());
            }
        } else {
            const rest = Decimal.max(accum.quantity.minus(txn.quantity), new Decimal(0));
            if (!accum.quantity.isZero()) {
                accum.cost = accum.cost.times(rest).div(accum.quantity);
            }
            accum.quantity = rest;
            if (rest.isZero()) {
                accum.cost = new Decimal(0);
                accum.firstBuyDate = null;
            }
        }
        if (txn.product !== '') {
            accum.product = txn.product;
        }
        if (txn.mutationCurrency !== null && txn.mutationCurrency !== '') {
            accum.currency = txn.mutationCurrency;
        }
    }
    const result: HoldingStats[] = [];
    for (const [isin, accum] of perIsin) {
        if (accum.quantity.isZero()) {
            continue;
        }
        result.push({
            isin,
            product: accum.product,
            currency: accum.currency,
            quantity: accum.quantity,
            firstBuyDate: accum.firstBuyDate,
            netInvested: accum.cost,
            netInvestedPerShare: accum.cost.div(accum.quantity),
        });
    }
    return result.sort((a, b) => b.netInvested.comparedTo(a.netInvested));
}

export function holdingPeriodDays(firstBuyDate: string, asOf: Date = new Date()): number {
    const start = new Date(`${firstBuyDate}T00:00:00Z`);
    const einde = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
    return Math.round((einde.getTime() - start.getTime()) / 86_400_000);
}
