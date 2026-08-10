import Decimal from 'decimal.js';

export type FxResolver = (valuta: string, datum: string) => Decimal | null;

export interface FxRateInput {
    readonly paar: string;
    readonly datum: string;
    readonly koers: string;
}

export function buildFxResolver(rates: readonly FxRateInput[], rapportagevaluta = 'EUR'): FxResolver {
    const perPaar = new Map<string, { datum: string; koers: Decimal }[]>();
    for (const rate of rates) {
        const lijst = perPaar.get(rate.paar) ?? [];
        lijst.push({ datum: rate.datum, koers: new Decimal(rate.koers) });
        perPaar.set(rate.paar, lijst);
    }
    for (const lijst of perPaar.values()) {
        lijst.sort((a, b) => a.datum.localeCompare(b.datum));
    }
    return (valuta: string, datum: string): Decimal | null => {
        if (valuta === rapportagevaluta) {
            return new Decimal(1);
        }
        const lijst = perPaar.get(`${valuta}/${rapportagevaluta}`);
        if (lijst === undefined) {
            return null;
        }
        let gevonden: Decimal | null = null;
        for (const rate of lijst) {
            if (rate.datum > datum) {
                break;
            }
            gevonden = rate.koers;
        }
        return gevonden;
    };
}
