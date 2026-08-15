import Decimal from 'decimal.js';
import { FxResolver, mutationInReportingCurrency } from './fx';
import { Transaction, TransactionTypes as T } from './types';

export interface HoldingStatsOptions {
    readonly reportingCurrency?: string;
    readonly fxFallback?: FxResolver;
    readonly includeClosed?: boolean;
}

export interface HoldingStats {
    readonly isin: string;
    readonly product: string;
    readonly currency: string;
    readonly open: boolean;
    readonly quantity: Decimal;
    readonly firstBuyDate: string | null;
    readonly closedAt: string | null;
    readonly netInvested: Decimal | null;
    readonly netInvestedPerShare: Decimal | null;
    readonly grossInvested: Decimal | null;
    readonly realizedPnl: Decimal | null;
}

interface PositionAccum {
    product: string;
    currency: string;
    quantity: Decimal;
    cost: Decimal;
    gross: Decimal;
    realized: Decimal;
    fxOk: boolean;
    firstBuyDate: string | null;
    closedAt: string | null;
}

const BUY_TYPES = new Set<string>([T.TradeBuy, T.CorporateBuy]);
const SELL_TYPES = new Set<string>([T.TradeSell, T.CorporateSell]);

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex;
}

export function holdingStats(transactions: readonly Transaction[], options: HoldingStatsOptions = {}): HoldingStats[] {
    const { reportingCurrency = 'EUR', fxFallback, includeClosed = false } = options;
    const perIsin = new Map<string, PositionAccum>();
    const sorted = [...transactions].sort(compareChronological);
    for (const txn of sorted) {
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
                gross: new Decimal(0),
                realized: new Decimal(0),
                fxOk: true,
                firstBuyDate: null,
                closedAt: null,
            };
            perIsin.set(txn.isin, accum);
        }
        const mutation = mutationInReportingCurrency(txn, reportingCurrency, fxFallback);
        if (txn.mutation !== null && mutation === null) {
            accum.fxOk = false;
        }
        if (isBuy) {
            if (accum.quantity.isZero()) {
                accum.firstBuyDate = txn.date;
                accum.closedAt = null;
            }
            accum.quantity = accum.quantity.plus(txn.quantity);
            if (mutation !== null) {
                const uitgave = mutation.abs();
                accum.cost = accum.cost.plus(uitgave);
                accum.gross = accum.gross.plus(uitgave);
            }
        } else {
            const rest = Decimal.max(accum.quantity.minus(txn.quantity), new Decimal(0));
            let kostprijsVerkocht = new Decimal(0);
            if (!accum.quantity.isZero()) {
                kostprijsVerkocht = accum.cost.times(Decimal.min(txn.quantity, accum.quantity)).div(accum.quantity);
                accum.cost = accum.cost.times(rest).div(accum.quantity);
            }
            accum.quantity = rest;
            if (mutation !== null) {
                accum.realized = accum.realized.plus(mutation).minus(kostprijsVerkocht);
            }
            if (rest.isZero()) {
                accum.cost = new Decimal(0);
                accum.closedAt = txn.date;
            }
        }
        if (txn.product !== '') {
            accum.product = txn.product;
        }
        if (txn.mutationCurrency !== null && txn.mutationCurrency !== '') {
            accum.currency = txn.mutationCurrency;
        }
    }
    const open: HoldingStats[] = [];
    const closed: HoldingStats[] = [];
    for (const [isin, accum] of perIsin) {
        const isOpen = !accum.quantity.isZero();
        const stats: HoldingStats = {
            isin,
            product: accum.product,
            currency: accum.currency,
            open: isOpen,
            quantity: accum.quantity,
            firstBuyDate: accum.firstBuyDate,
            closedAt: accum.closedAt,
            netInvested: isOpen && accum.fxOk ? accum.cost : null,
            netInvestedPerShare: isOpen && accum.fxOk ? accum.cost.div(accum.quantity) : null,
            grossInvested: accum.fxOk ? accum.gross : null,
            realizedPnl: accum.fxOk ? accum.realized : null,
        };
        if (isOpen) {
            open.push(stats);
        } else if (includeClosed) {
            closed.push(stats);
        }
    }
    open.sort((a, b) => (b.netInvested ?? new Decimal(0)).comparedTo(a.netInvested ?? new Decimal(0)));
    closed.sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
    return [...open, ...closed];
}

export function holdingPeriodDays(firstBuyDate: string, asOf: Date = new Date()): number {
    const start = new Date(`${firstBuyDate}T00:00:00Z`);
    const einde = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
    return Math.round((einde.getTime() - start.getTime()) / 86_400_000);
}
