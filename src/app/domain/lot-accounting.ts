import Decimal from 'decimal.js';
import { compareTransactions, groupCorporateActions } from './corporate-action-grouping';
import { FxResolver, mutationInReportingCurrency } from './fx';
import { mergeSplitExecutions } from './split-execution-merge';
import { Transaction, TransactionTypes as T } from './types';

export type LotConsumptionStrategy = 'fifo' | 'lifo';

export interface AccountingLot {
    readonly quantity: Decimal;
    readonly basis: Decimal;
    readonly acquiredAt: string;
    readonly basisAssumedZero: boolean;
}

export interface ClosedLotMatch {
    readonly soldAt: string;
    readonly soldTransactionId: string;
    readonly quantity: Decimal;
    readonly acquiredAt: string;
    readonly basis: Decimal;
    readonly proceeds: Decimal | null;
    readonly basisAssumedZero: boolean;
}

export interface LotAccountingPosition {
    readonly isin: string;
    readonly product: string;
    readonly currency: string;
    readonly lots: readonly AccountingLot[];
    readonly closedLots: readonly ClosedLotMatch[];
    readonly grossInvested: Decimal;
    readonly realizedPnl: Decimal | null;
    readonly basisComplete: boolean;
    readonly realizedComplete: boolean;
    readonly realizedBasisAssumedZero: boolean;
    readonly accountingComplete: boolean;
    readonly firstBuyDate: string | null;
    readonly closedAt: string | null;
}

export interface LotAccountingDiagnostic {
    readonly transactionId: string;
    readonly rowIndex: number;
    readonly kind: 'OVERSELL' | 'MISSING_MONEY' | 'UNMATCHED_CORPORATE_ACTION' | 'MISSING_CORPORATE_ACTION_BASIS';
    readonly quantity?: Decimal;
}

export interface LotAccountingResult {
    readonly positions: ReadonlyMap<string, LotAccountingPosition>;
    readonly diagnostics: readonly LotAccountingDiagnostic[];
}

export interface LotAccountingOptions {
    readonly reportingCurrency?: string;
    readonly fxFallback?: FxResolver;
    readonly strategy?: LotConsumptionStrategy;
}

interface MutableLot {
    quantity: Decimal;
    basis: Decimal;
    acquiredAt: string;
    basisAssumedZero: boolean;
}

interface MutablePosition {
    isin: string;
    product: string;
    currency: string;
    lots: MutableLot[];
    closedLots: ClosedLotMatch[];
    grossInvested: Decimal;
    realizedPnl: Decimal;
    basisComplete: boolean;
    realizedComplete: boolean;
    realizedBasisAssumedZero: boolean;
    firstBuyDate: string | null;
    closedAt: string | null;
}

const BUY_TYPES = new Set<string>([T.TradeBuy, T.CorporateBuy]);
const SELL_TYPES = new Set<string>([T.TradeSell, T.CorporateSell]);
const FEE_TYPES = new Set<string>([T.TransactionFee, T.TransactionTax]);

function fallbackAssociationKey(txn: Transaction): string | null {
    return txn.isin === null ? null : `${txn.date}:${txn.time}:${txn.isin}`;
}

function quantityOf(position: MutablePosition): Decimal {
    return position.lots.reduce((sum, lot) => sum.plus(lot.quantity), new Decimal(0));
}

function positionFor(positions: Map<string, MutablePosition>, txn: Transaction): MutablePosition {
    const isin = txn.isin as string;
    let position = positions.get(isin);
    if (position === undefined) {
        position = {
            isin,
            product: txn.product,
            currency: txn.mutationCurrency ?? txn.tradeCurrency ?? '',
            lots: [],
            closedLots: [],
            grossInvested: new Decimal(0),
            realizedPnl: new Decimal(0),
            basisComplete: true,
            realizedComplete: true,
            realizedBasisAssumedZero: false,
            firstBuyDate: null,
            closedAt: null,
        };
        positions.set(isin, position);
    }
    if (txn.product !== '') {
        position.product = txn.product;
    }
    if (txn.mutationCurrency !== null && txn.mutationCurrency !== '') {
        position.currency = txn.mutationCurrency;
    }
    return position;
}

function consumeLots(
    position: MutablePosition,
    requested: Decimal,
    strategy: LotConsumptionStrategy,
): { lots: MutableLot[]; basis: Decimal } {
    let remaining = requested;
    const consumed: MutableLot[] = [];
    let basis = new Decimal(0);
    while (remaining.gt(0) && position.lots.length > 0) {
        const index = strategy === 'lifo' ? position.lots.length - 1 : 0;
        const lot = position.lots[index];
        const quantity = Decimal.min(remaining, lot.quantity);
        const lotBasis = lot.basis.times(quantity).div(lot.quantity);
        consumed.push({
            quantity,
            basis: lotBasis,
            acquiredAt: lot.acquiredAt,
            basisAssumedZero: lot.basisAssumedZero,
        });
        lot.quantity = lot.quantity.minus(quantity);
        lot.basis = lot.basis.minus(lotBasis);
        basis = basis.plus(lotBasis);
        remaining = remaining.minus(quantity);
        if (lot.quantity.isZero()) {
            position.lots.splice(index, 1);
        }
    }
    return { lots: consumed, basis };
}

function recordClosedLots(
    position: MutablePosition,
    txn: Transaction,
    consumed: { lots: MutableLot[]; basis: Decimal },
    monetary: { amount: Decimal | null; fee: Decimal | null },
): void {
    if (consumed.lots.length === 0) {
        return;
    }
    const netProceeds = monetary.amount !== null && monetary.fee !== null ? monetary.amount.minus(monetary.fee) : null;
    const totalQuantity = consumed.lots.reduce((sum, lot) => sum.plus(lot.quantity), new Decimal(0));
    let allocated = new Decimal(0);
    for (const [index, lot] of consumed.lots.entries()) {
        let proceeds: Decimal | null = null;
        if (netProceeds !== null && !totalQuantity.isZero()) {
            proceeds =
                index === consumed.lots.length - 1
                    ? netProceeds.minus(allocated)
                    : netProceeds.times(lot.quantity).div(totalQuantity);
            allocated = allocated.plus(proceeds);
        }
        position.closedLots.push({
            soldAt: txn.date,
            soldTransactionId: txn.id,
            quantity: lot.quantity,
            acquiredAt: lot.acquiredAt,
            basis: lot.basis,
            proceeds,
            basisAssumedZero: lot.basisAssumedZero,
        });
    }
}

export function accountLots(
    transactions: readonly Transaction[],
    options: LotAccountingOptions = {},
): LotAccountingResult {
    const { reportingCurrency = 'EUR', fxFallback, strategy = 'fifo' } = options;
    const sorted = [...mergeSplitExecutions(transactions)].sort(compareTransactions);
    const positions = new Map<string, MutablePosition>();
    const diagnostics: LotAccountingDiagnostic[] = [];
    const associated = new Map<Transaction, Transaction[]>();
    const corporateGroups = groupCorporateActions(sorted);
    const corporateByTransaction = new Map<Transaction, (typeof corporateGroups)[number]>();

    for (const group of corporateGroups) {
        for (const txn of group.rows) {
            corporateByTransaction.set(txn, group);
        }
    }
    const orderGroups = new Map<string, Transaction[]>();
    const orderIdsByFallback = new Map<string, Set<string>>();
    for (const txn of sorted) {
        if (txn.orderId === null) continue;
        const orderGroup = orderGroups.get(txn.orderId) ?? [];
        orderGroup.push(txn);
        orderGroups.set(txn.orderId, orderGroup);
        const fallback = fallbackAssociationKey(txn);
        if (fallback !== null) {
            const ids = orderIdsByFallback.get(fallback) ?? new Set<string>();
            ids.add(txn.orderId);
            orderIdsByFallback.set(fallback, ids);
        }
    }
    const fallbackGroups = new Map<string, Transaction[]>();
    for (const txn of sorted) {
        if (txn.orderId !== null) continue;
        const fallback = fallbackAssociationKey(txn);
        if (fallback === null) {
            associated.set(txn, [txn]);
            continue;
        }
        const candidateIds = orderIdsByFallback.get(fallback);
        if (candidateIds?.size === 1) {
            const group = orderGroups.get([...candidateIds][0]) as Transaction[];
            group.push(txn);
            continue;
        }
        const group = fallbackGroups.get(fallback) ?? [];
        group.push(txn);
        fallbackGroups.set(fallback, group);
    }
    for (const group of [...orderGroups.values(), ...fallbackGroups.values()]) {
        for (const txn of group) associated.set(txn, group);
    }

    const money = (txn: Transaction): { amount: Decimal | null; fee: Decimal | null } => {
        const group = associated.get(txn) ?? [txn];
        const sameSide = group.filter((entry) =>
            BUY_TYPES.has(txn.type) ? BUY_TYPES.has(entry.type) : SELL_TYPES.has(entry.type),
        );
        const weightTotal = sameSide.reduce((sum, entry) => sum.plus(entry.mutation?.abs() ?? 0), new Decimal(0));
        const weight = weightTotal.isZero()
            ? new Decimal(1).div(sameSide.length || 1)
            : (txn.mutation?.abs() ?? new Decimal(0)).div(weightTotal);
        const settlement = group
            .filter(
                (entry) =>
                    (entry.type === T.FxDebit || entry.type === T.FxCredit) &&
                    entry.mutationCurrency === reportingCurrency &&
                    entry.mutation !== null &&
                    (BUY_TYPES.has(txn.type) ? entry.mutation.lt(0) : entry.mutation.gt(0)),
            )
            .reduce((sum, entry) => sum.plus((entry.mutation as Decimal).abs()), new Decimal(0));
        const direct = mutationInReportingCurrency(txn, reportingCurrency, fxFallback);
        const amount = settlement.gt(0) ? settlement.times(weight) : (direct?.abs() ?? null);
        let fee: Decimal | null = new Decimal(0);
        for (const entry of group.filter((candidate) => FEE_TYPES.has(candidate.type))) {
            const converted = mutationInReportingCurrency(entry, reportingCurrency, fxFallback);
            if (converted === null) {
                fee = null;
                break;
            }
            fee = fee.plus(converted.abs().times(weight));
        }
        return { amount, fee };
    };

    const processedCorporate = new Set<(typeof corporateGroups)[number]>();
    for (const txn of sorted) {
        if (txn.isin === null || txn.quantity === null) {
            continue;
        }
        if (txn.corporateAction !== null) {
            const group = corporateByTransaction.get(txn);
            if (group === undefined || processedCorporate.has(group)) {
                continue;
            }
            processedCorporate.add(group);
            const rows = group.rows.filter((entry) => entry.isin !== null && entry.quantity !== null);
            const sells = rows.filter((entry) => entry.type === T.CorporateSell);
            const buys = rows.filter((entry) => entry.type === T.CorporateBuy);
            const transferred: MutableLot[] = [];
            let transferredBasisComplete = true;
            for (const sell of sells) {
                const position = positionFor(positions, sell);
                const available = quantityOf(position);
                const consumed = consumeLots(position, sell.quantity as Decimal, strategy);
                transferred.push(...consumed.lots);
                transferredBasisComplete &&= position.basisComplete;
                if ((sell.quantity as Decimal).gt(available)) {
                    position.realizedComplete = false;
                    position.basisComplete = false;
                    transferredBasisComplete = false;
                    diagnostics.push({
                        transactionId: sell.id,
                        rowIndex: sell.rowIndex,
                        kind: 'OVERSELL',
                        quantity: (sell.quantity as Decimal).minus(available),
                    });
                }
                if (quantityOf(position).isZero()) position.closedAt = sell.date;
            }
            const sourceQuantity = transferred.reduce((sum, lot) => sum.plus(lot.quantity), new Decimal(0));
            const targetQuantity = buys.reduce((sum, buy) => sum.plus(buy.quantity as Decimal), new Decimal(0));
            const sourceIsins = new Set(sells.map((sell) => sell.isin));
            const targetIsins = new Set(buys.map((buy) => buy.isin));
            const ambiguousTransfer = sourceIsins.size > 1 || targetIsins.size > 1;
            if (targetQuantity.isZero() || ambiguousTransfer) {
                transferredBasisComplete = false;
                for (const sell of sells) {
                    const source = positionFor(positions, sell);
                    source.basisComplete = false;
                    source.realizedComplete = false;
                }
                diagnostics.push({ transactionId: txn.id, rowIndex: txn.rowIndex, kind: 'UNMATCHED_CORPORATE_ACTION' });
            }
            for (const buy of buys) {
                const position = positionFor(positions, buy);
                if (sourceQuantity.isZero()) {
                    const monetary = money(buy);
                    const hasBrokerBasis = monetary.amount !== null && monetary.amount.gt(0) && monetary.fee !== null;
                    const basis = hasBrokerBasis
                        ? (monetary.amount as Decimal).plus(monetary.fee as Decimal)
                        : new Decimal(0);
                    const basisAssumedZero =
                        !hasBrokerBasis &&
                        sells.length === 0 &&
                        rows.every((row) => row.type === T.CorporateBuy && row.corporateAction === 'SPIN_OFF') &&
                        buys.every((row) => row.mutation !== null && row.mutation.isZero()) &&
                        monetary.fee !== null &&
                        monetary.fee.isZero();
                    position.lots.push({
                        quantity: buy.quantity as Decimal,
                        basis,
                        acquiredAt: buy.date,
                        basisAssumedZero,
                    });
                    position.grossInvested = position.grossInvested.plus(basis);
                    if (!hasBrokerBasis) {
                        position.basisComplete = false;
                        if (!basisAssumedZero) position.realizedComplete = false;
                        diagnostics.push({
                            transactionId: buy.id,
                            rowIndex: buy.rowIndex,
                            kind: 'MISSING_CORPORATE_ACTION_BASIS',
                            quantity: buy.quantity as Decimal,
                        });
                    }
                } else {
                    const buyShare = (buy.quantity as Decimal).div(targetQuantity);
                    let allocatedQuantity = new Decimal(0);
                    for (const [index, lot] of transferred.entries()) {
                        const quantity =
                            index === transferred.length - 1
                                ? (buy.quantity as Decimal).minus(allocatedQuantity)
                                : (buy.quantity as Decimal).times(lot.quantity).div(sourceQuantity);
                        const basis = lot.basis.times(buyShare);
                        allocatedQuantity = allocatedQuantity.plus(quantity);
                        if (!quantity.isZero()) {
                            position.lots.push({
                                quantity,
                                basis,
                                acquiredAt: lot.acquiredAt,
                                basisAssumedZero: lot.basisAssumedZero,
                            });
                            if (!sourceIsins.has(position.isin)) {
                                position.grossInvested = position.grossInvested.plus(basis);
                            }
                        }
                    }
                    position.lots.sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));
                    position.basisComplete &&= transferredBasisComplete;
                    position.realizedComplete &&= transferredBasisComplete;
                }
                if (!quantityOf(position).isZero()) {
                    position.firstBuyDate = position.lots[0]?.acquiredAt ?? buy.date;
                    position.closedAt = null;
                }
            }
            continue;
        }
        if (!BUY_TYPES.has(txn.type) && !SELL_TYPES.has(txn.type)) {
            continue;
        }
        const position = positionFor(positions, txn);
        const monetary = money(txn);
        if (monetary.amount === null || monetary.fee === null) {
            if (BUY_TYPES.has(txn.type)) position.basisComplete = false;
            position.realizedComplete = false;
            diagnostics.push({ transactionId: txn.id, rowIndex: txn.rowIndex, kind: 'MISSING_MONEY' });
        }
        if (BUY_TYPES.has(txn.type)) {
            const basis = monetary.amount?.plus(monetary.fee ?? 0) ?? new Decimal(0);
            if (quantityOf(position).isZero()) {
                position.firstBuyDate = txn.date;
                position.closedAt = null;
                if (monetary.amount !== null && monetary.fee !== null) {
                    position.basisComplete = true;
                }
            }
            position.lots.push({ quantity: txn.quantity, basis, acquiredAt: txn.date, basisAssumedZero: false });
            position.grossInvested = position.grossInvested.plus(basis);
        } else {
            const available = quantityOf(position);
            const consumed = consumeLots(position, txn.quantity, strategy);
            recordClosedLots(position, txn, consumed, monetary);
            const oversold = txn.quantity.gt(available);
            if (oversold) {
                position.realizedComplete = false;
                diagnostics.push({
                    transactionId: txn.id,
                    rowIndex: txn.rowIndex,
                    kind: 'OVERSELL',
                    quantity: txn.quantity.minus(available),
                });
            }
            if (!oversold && monetary.amount !== null && monetary.fee !== null && position.realizedComplete) {
                position.realizedPnl = position.realizedPnl
                    .plus(monetary.amount.minus(monetary.fee))
                    .minus(consumed.basis);
                if (consumed.lots.some((lot) => lot.basisAssumedZero)) {
                    position.realizedBasisAssumedZero = true;
                }
            }
            if (quantityOf(position).isZero()) {
                position.closedAt = txn.date;
            }
        }
    }

    return {
        positions: new Map(
            [...positions].map(([isin, position]) => [
                isin,
                {
                    ...position,
                    realizedPnl: position.realizedComplete ? position.realizedPnl : null,
                    accountingComplete: position.basisComplete && position.realizedComplete,
                    lots: position.lots.map((lot) => ({ ...lot })),
                },
            ]),
        ),
        diagnostics,
    };
}
