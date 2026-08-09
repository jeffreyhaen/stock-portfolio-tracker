import Decimal from 'decimal.js';

export interface PositionExpectation {
    readonly isin: string;
    readonly quantity: string;
}

export interface PositionMismatch {
    readonly isin: string;
    readonly expected: string;
    readonly actual: string;
}

export interface ReconcileReport {
    readonly ok: boolean;
    readonly mismatches: PositionMismatch[];
    readonly unexpectedOpen: PositionMismatch[];
}

export function reconcilePositions(
    expected: readonly PositionExpectation[],
    actual: ReadonlyMap<string, Decimal>,
): ReconcileReport {
    const mismatches: PositionMismatch[] = [];
    const unexpectedOpen: PositionMismatch[] = [];
    for (const expectation of expected) {
        const actualQuantity = actual.get(expectation.isin) ?? new Decimal(0);
        if (!actualQuantity.eq(new Decimal(expectation.quantity))) {
            mismatches.push({
                isin: expectation.isin,
                expected: expectation.quantity,
                actual: actualQuantity.toFixed(),
            });
        }
    }
    for (const [isin, quantity] of actual) {
        if (quantity.isZero()) {
            continue;
        }
        const known = expected.some((expectation) => expectation.isin === isin);
        if (!known) {
            unexpectedOpen.push({ isin, expected: '0', actual: quantity.toFixed() });
        }
    }
    return { ok: mismatches.length === 0 && unexpectedOpen.length === 0, mismatches, unexpectedOpen };
}
