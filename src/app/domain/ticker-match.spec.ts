import { exchangeCode, exchangeDisplayName, chooseTickerCandidate, stripYahooSuffix } from './ticker-match';
import { TickerSuggestion } from '../data/market-data-provider';

function suggestion(symbol: string, exchange: string): TickerSuggestion {
    return { symbol, name: symbol, exchange };
}

describe('chooseTickerCandidate', () => {
    it('chooses the exchange matching the trading currency (EUR -> Amsterdam)', () => {
        const suggestions = [suggestion('VUSA.L', 'London'), suggestion('VUSA.AS', 'Amsterdam')];
        const choice = chooseTickerCandidate(suggestions, 'EUR');
        expect(choice.candidate?.symbol).toBe('VUSA.AS');
        expect(choice.currencyMatch).toBe(true);
    });

    it('chooses Nasdaq/NYSE for USD products', () => {
        const suggestions = [suggestion('ASML.AS', 'Amsterdam'), suggestion('ASML', 'NASDAQ')];
        expect(chooseTickerCandidate(suggestions, 'USD').candidate?.symbol).toBe('ASML');
    });

    it('falls back to the first suggestion without a currency match', () => {
        const choice = chooseTickerCandidate([suggestion('VUSA.L', 'London')], 'EUR');
        expect(choice.candidate?.symbol).toBe('VUSA.L');
        expect(choice.currencyMatch).toBe(false);
    });

    it('returns null without suggestions', () => {
        expect(chooseTickerCandidate([], 'USD').candidate).toBeNull();
    });

    it('ignores the currency preference when it is unknown', () => {
        expect(chooseTickerCandidate([suggestion('AMD', 'NASDAQ')], null).candidate?.symbol).toBe('AMD');
    });
});

describe('exchangeDisplayName', () => {
    it('maps Yahoo exchange names to short forms', () => {
        expect(exchangeDisplayName('NasdaqGS')).toBe('NASDAQ');
        expect(exchangeDisplayName('NYSE')).toBe('NYSE');
        expect(exchangeDisplayName('NYSEArca')).toBe('NYSE Arca');
        expect(exchangeDisplayName('Amsterdam')).toBe('Euronext Amsterdam');
        expect(exchangeDisplayName('XETRA')).toBe('XETRA');
        expect(exchangeDisplayName('TSXV')).toBe('TSXV');
        expect(exchangeDisplayName('Toronto')).toBe('TSX');
    });

    it('leaves unknown exchange names unchanged', () => {
        expect(exchangeDisplayName('BATS')).toBe('BATS');
    });
});

describe('exchangeCode', () => {
    it('chooses short codes for EU/US exchanges', () => {
        expect(exchangeCode('NasdaqGS')).toBe('NASDAQ');
        expect(exchangeCode('NASDAQ')).toBe('NASDAQ');
        expect(exchangeCode('NYSE')).toBe('NYSE');
        expect(exchangeCode('NYSEArca')).toBe('NYSE Arca');
        expect(exchangeCode('NYSE American')).toBe('NYSE American');
        expect(exchangeCode('Amsterdam')).toBe('AMS');
        expect(exchangeCode('Euronext Amsterdam')).toBe('AMS');
        expect(exchangeCode('XETRA')).toBe('XETRA');
        expect(exchangeCode('Brussels')).toBe('BRU');
        expect(exchangeCode('Paris')).toBe('PAR');
        expect(exchangeCode('London')).toBe('LSE');
        expect(exchangeCode('Milan')).toBe('MIL');
        expect(exchangeCode('Toronto')).toBe('TSX');
        expect(exchangeCode('TSXV')).toBe('TSXV');
    });

    it('returns null for unknown exchanges', () => {
        expect(exchangeCode('BATS')).toBeNull();
        expect(exchangeCode('')).toBeNull();
    });
});

describe('stripYahooSuffix', () => {
    it('removes known Yahoo suffixes', () => {
        expect(stripYahooSuffix('VUSA.AS')).toBe('VUSA');
        expect(stripYahooSuffix('SAP.DE')).toBe('SAP');
        expect(stripYahooSuffix('VOD.L')).toBe('VOD');
    });

    it('leaves tickers without a suffix or with an unknown suffix unchanged', () => {
        expect(stripYahooSuffix('ASML')).toBe('ASML');
        expect(stripYahooSuffix('VUSA.QQ')).toBe('VUSA.QQ');
        expect(stripYahooSuffix('ASML.')).toBe('ASML.');
    });
});
