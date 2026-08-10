import { TickerSuggestion } from '../data/quote-provider';

const EXCHANGE_VOOR_VALUTA: Record<string, string[]> = {
    EUR: [
        'Amsterdam',
        'Brussels',
        'Paris',
        'XETRA',
        'Frankfurt',
        'Milan',
        'Madrid',
        'Lisbon',
        'Vienna',
        'Borsa Italiana',
    ],
    USD: ['NASDAQ', 'NasdaqGS', 'NYSE', 'NYSEArca', 'NYSE American', 'SNP'],
    GBP: ['London'],
    CAD: ['Toronto', 'TSXV'],
};

export interface TickerKeuze {
    readonly kandidaat: TickerSuggestion | null;
    readonly viaValutaMatch: boolean;
}

export function kiesTickerKandidaat(
    suggesties: readonly TickerSuggestion[],
    handelsvaluta: string | null,
): TickerKeuze {
    if (suggesties.length === 0) {
        return { kandidaat: null, viaValutaMatch: false };
    }
    const voorkeur = handelsvaluta === null ? [] : (EXCHANGE_VOOR_VALUTA[handelsvaluta] ?? []);
    const match = suggesties.find((s) =>
        voorkeur.some((beurs) => s.exchange.toLowerCase().includes(beurs.toLowerCase())),
    );
    if (match !== undefined) {
        return { kandidaat: match, viaValutaMatch: true };
    }
    return { kandidaat: suggesties[0], viaValutaMatch: false };
}
