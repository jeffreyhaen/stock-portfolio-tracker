import Decimal from 'decimal.js';
import { holdingPeriodDays } from './holdings';
import { AccountingLot, ClosedLotMatch } from './lot-accounting';

export interface LotView {
    readonly acquiredAt: string;
    readonly quantity: Decimal;
    readonly costBasis: Decimal;
    readonly costPerShare: Decimal | null;
    readonly value: Decimal | null;
    readonly pnl: Decimal | null;
    readonly pnlPct: Decimal | null;
    readonly holdingDays: number;
    readonly basisAssumedZero: boolean;
}

export interface ClosedLotView {
    readonly soldAt: string;
    readonly quantity: Decimal;
    readonly acquiredAt: string;
    readonly costBasis: Decimal;
    readonly proceeds: Decimal | null;
    readonly pnl: Decimal | null;
    readonly pnlPct: Decimal | null;
    readonly basisAssumedZero: boolean;
}

export function buildLotViews(
    lots: readonly AccountingLot[],
    valuePerShare: Decimal | null,
    asOf: Date = new Date(),
): LotView[] {
    return lots.map((lot) => {
        const costPerShare = lot.quantity.isZero() ? null : lot.basis.div(lot.quantity);
        const value = valuePerShare === null ? null : lot.quantity.times(valuePerShare);
        const pnl = value === null ? null : value.minus(lot.basis);
        const pnlPct = pnl === null || lot.basis.isZero() ? null : pnl.div(lot.basis).times(100);
        return {
            acquiredAt: lot.acquiredAt,
            quantity: lot.quantity,
            costBasis: lot.basis,
            costPerShare,
            value,
            pnl,
            pnlPct,
            holdingDays: holdingPeriodDays(lot.acquiredAt, asOf),
            basisAssumedZero: lot.basisAssumedZero,
        };
    });
}

export function buildClosedLotViews(matches: readonly ClosedLotMatch[]): ClosedLotView[] {
    return matches.map((match) => {
        const pnl = match.proceeds === null ? null : match.proceeds.minus(match.basis);
        const pnlPct = pnl === null || match.basis.isZero() ? null : pnl.div(match.basis).times(100);
        return {
            soldAt: match.soldAt,
            quantity: match.quantity,
            acquiredAt: match.acquiredAt,
            costBasis: match.basis,
            proceeds: match.proceeds,
            pnl,
            pnlPct,
            basisAssumedZero: match.basisAssumedZero,
        };
    });
}
