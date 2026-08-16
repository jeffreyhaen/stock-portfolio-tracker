import { TickerSuggestion } from '../data/market-data-provider';

const EXCHANGES_BY_CURRENCY: Record<string, string[]> = {
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

const EXCHANGE_DISPLAY: [RegExp, string][] = [
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

export function exchangeDisplayName(exchange: string): string {
    for (const [pattern, name] of EXCHANGE_DISPLAY) {
        if (pattern.test(exchange)) {
            return name;
        }
    }
    return exchange;
}

const EXCHANGE_CODES: [RegExp, string][] = [
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

export function exchangeCode(exchange: string): string | null {
    for (const [pattern, code] of EXCHANGE_CODES) {
        if (pattern.test(exchange)) {
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
    const dot = ticker.lastIndexOf('.');
    if (dot < 0 || dot === ticker.length - 1) {
        return ticker;
    }
    const suffix = ticker.slice(dot + 1).toUpperCase();
    if (YAHOO_SUFFIX[suffix] === undefined) {
        return ticker;
    }
    return ticker.slice(0, dot);
}

export interface TickerChoice {
    readonly candidate: TickerSuggestion | null;
    readonly currencyMatch: boolean;
}

export function chooseTickerCandidate(
    suggestions: readonly TickerSuggestion[],
    tradingCurrency: string | null,
): TickerChoice {
    if (suggestions.length === 0) {
        return { candidate: null, currencyMatch: false };
    }
    const preference = tradingCurrency === null ? [] : (EXCHANGES_BY_CURRENCY[tradingCurrency] ?? []);
    const match = suggestions.find((s) =>
        preference.some((exchange) => s.exchange.toLowerCase().includes(exchange.toLowerCase())),
    );
    if (match !== undefined) {
        return { candidate: match, currencyMatch: true };
    }
    return { candidate: suggestions[0], currencyMatch: false };
}
