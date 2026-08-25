import Decimal from 'decimal.js';
import { FxResolver } from './fx';
import { accountLots, LotConsumptionStrategy } from './lot-accounting';
import { Transaction } from './types';

export interface HoldingStatsOptions {
    readonly reportingCurrency?: string;
    readonly fxFallback?: FxResolver;
    readonly includeClosed?: boolean;
    readonly strategy?: LotConsumptionStrategy;
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
    readonly basisComplete: boolean;
    readonly realizedComplete: boolean;
    readonly realizedBasisAssumedZero: boolean;
    readonly accountingComplete: boolean;
}

export function holdingStats(transactions: readonly Transaction[], options: HoldingStatsOptions = {}): HoldingStats[] {
    const { reportingCurrency = 'EUR', fxFallback, includeClosed = false, strategy = 'fifo' } = options;
    const accounting = accountLots(transactions, { reportingCurrency, fxFallback, strategy });
    const open: HoldingStats[] = [];
    const closed: HoldingStats[] = [];
    for (const position of accounting.positions.values()) {
        const quantity = position.lots.reduce((sum, lot) => sum.plus(lot.quantity), new Decimal(0));
        const basis = position.lots.reduce((sum, lot) => sum.plus(lot.basis), new Decimal(0));
        const isOpen = !quantity.isZero();
        const stats: HoldingStats = {
            isin: position.isin,
            product: position.product,
            currency: position.currency,
            open: isOpen,
            quantity,
            firstBuyDate: position.firstBuyDate,
            closedAt: position.closedAt,
            netInvested: isOpen && position.basisComplete ? basis : null,
            netInvestedPerShare: isOpen && position.basisComplete ? basis.div(quantity) : null,
            grossInvested: position.basisComplete ? position.grossInvested : null,
            realizedPnl: position.realizedComplete ? position.realizedPnl : null,
            basisComplete: position.basisComplete,
            realizedComplete: position.realizedComplete,
            realizedBasisAssumedZero: position.realizedBasisAssumedZero,
            accountingComplete: position.accountingComplete,
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
