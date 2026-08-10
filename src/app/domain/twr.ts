import Decimal from 'decimal.js';

export interface TwrInput {
    readonly datum: string;
    readonly value: Decimal | null;
    readonly flow: Decimal;
}

// Externe flows gelden als begin-van-de-dag: r = V / (V_vorige + flow) - 1.

export interface TwrResult {
    readonly twr: Decimal | null;
    readonly twrPct: Decimal | null;
    readonly dagen: number;
}

export function timeWeightedReturn(punten: readonly TwrInput[]): TwrResult {
    let factor = new Decimal(1);
    let vorige: Decimal | null = null;
    let dagen = 0;
    for (const punt of punten) {
        if (punt.value === null || (punt.value.isZero() && punt.flow.isZero())) {
            continue;
        }
        if (vorige !== null && !vorige.plus(punt.flow).isZero()) {
            const rendement = punt.value.div(vorige.plus(punt.flow));
            factor = factor.times(rendement);
            dagen++;
        }
        vorige = punt.value;
    }
    if (dagen === 0) {
        return { twr: null, twrPct: null, dagen };
    }
    const twr = factor.minus(1);
    return { twr, twrPct: twr.times(100), dagen };
}
