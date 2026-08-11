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

const BEURS_DISPLAY: [RegExp, string][] = [
    [/tsx venture|^tsxv/i, 'TSXV'],
    [/toronto|^tsx/i, 'TSX'],
    [/nasdaq/i, 'NASDAQ'],
    [/nyse american/i, 'NYSE American'],
    [/nyse\s?arca/i, 'NYSE Arca'],
    [/new york|^nyse/i, 'NYSE'],
    [/xetra|frankfurt/i, 'XETRA'],
    [/amsterdam/i, 'Euronext Amsterdam'],
    [/brussels/i, 'Euronext Brussels'],
    [/paris/i, 'Euronext Paris'],
    [/lisbon/i, 'Euronext Lisbon'],
    [/london|^lse/i, 'LSE'],
    [/milan|borsa italiana/i, 'Borsa Italiana'],
    [/madrid/i, 'Bolsa de Madrid'],
    [/vienna/i, 'Wiener Börse'],
    [/six|snp/i, 'SIX'],
];

export function beursDisplayNaam(exchange: string): string {
    for (const [patroon, naam] of BEURS_DISPLAY) {
        if (patroon.test(exchange)) {
            return naam;
        }
    }
    return exchange;
}

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
