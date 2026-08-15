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

const BEURS_CODE: [RegExp, string][] = [
    [/tsx venture|^tsxv/i, 'TSXV'],
    [/toronto|^tsx/i, 'TSX'],
    [/nasdaq/i, 'NASDAQ'],
    [/nyse american/i, 'NYSE American'],
    [/nyse\s?arca/i, 'NYSE Arca'],
    [/new york|^nyse/i, 'NYSE'],
    [/xetra|frankfurt/i, 'XETRA'],
    [/amsterdam/i, 'AMS'],
    [/brussels/i, 'BRU'],
    [/paris/i, 'PAR'],
    [/lisbon/i, 'LIS'],
    [/london|^lse/i, 'LSE'],
    [/milan|borsa italiana/i, 'MIL'],
    [/madrid/i, 'MAD'],
    [/vienna/i, 'VIE'],
    [/six|snp/i, 'SIX'],
    [/asx/i, 'ASX'],
    [/hkex|hong kong/i, 'HKEX'],
    [/tse|tokyo/i, 'TSE'],
];

export function beursCode(exchange: string): string | null {
    for (const [patroon, code] of BEURS_CODE) {
        if (patroon.test(exchange)) {
            return code;
        }
    }
    return null;
}

const YAHOO_SUFFIX: Record<string, string> = {
    AS: 'AMS',
    BR: 'BRU',
    DE: 'XETRA',
    F: 'FRA',
    L: 'LSE',
    LS: 'LIS',
    MI: 'MIL',
    MC: 'MAD',
    PA: 'PAR',
    VI: 'VIE',
    SW: 'SIX',
    TO: 'TSX',
    V: 'TSXV',
    AX: 'ASX',
    HK: 'HKEX',
    T: 'TSE',
    KS: 'KSE',
    SS: 'SSE',
    SZ: 'SZSE',
};

export function stripYahooSuffix(ticker: string): string {
    const punt = ticker.lastIndexOf('.');
    if (punt < 0 || punt === ticker.length - 1) {
        return ticker;
    }
    const suffix = ticker.slice(punt + 1).toUpperCase();
    if (YAHOO_SUFFIX[suffix] === undefined) {
        return ticker;
    }
    return ticker.slice(0, punt);
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
