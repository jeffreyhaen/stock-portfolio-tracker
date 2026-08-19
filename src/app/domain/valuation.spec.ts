import Decimal from 'decimal.js';
import { buildFxResolver } from './fx';
import { buildValuation, QuoteInput, rangeTotals } from './valuation';
import { MINI_CSV } from '../../testing/seed';
import { parseCsv } from './csv/parse-csv';
import { repairCsvRows } from './csv/repair-csv-rows';
import { buildLedger } from './ledger';
import { Transaction, TransactionTypes } from './types';

function miniLedger() {
    return buildLedger(repairCsvRows(parseCsv(MINI_CSV).map((row) => row.slice(0, 12)))).transactions;
}

const FX = buildFxResolver([]);

function eurQuotes(entries: [string, string][]): Map<string, QuoteInput> {
    return new Map(entries.map(([isin, price]) => [isin, { price: new Decimal(price), currency: 'EUR' }]));
}

function flow(overrides: Partial<Transaction>): Transaction {
    return {
        id: 'test',
        date: '2026-02-14',
        time: '10:00',
        valueDate: '2026-02-14',
        rowIndex: 0,
        product: '',
        isin: null,
        type: TransactionTypes.Dividend,
        corporateAction: null,
        quantity: null,
        price: null,
        tradeCurrency: null,
        mutation: new Decimal(0),
        mutationCurrency: 'EUR',
        balance: null,
        balanceCurrency: null,
        fxRate: null,
        orderId: null,
        description: '',
        fingerprint: 'test',
        ...overrides,
    };
}

describe('buildValuation', () => {
    it('builds daily points with netInvested from external flows', () => {
        const v = buildValuation(miniLedger(), new Map(), FX, '2026-02-14');
        expect(v.points.map((p) => p.date)).toEqual(['2021-01-01', '2026-02-12', '2026-02-13', '2026-02-14']);
        expect(v.points[0].netInvested.toFixed(2)).toBe('50000.00');
        expect(v.totals.netInvested.toFixed(2)).toBe('50000.00');
        expect(v.nonReportingExternalFlows).toBe(0);
    });

    it('uses latest real trades when quotes are unavailable', () => {
        const v = buildValuation(miniLedger(), new Map(), FX, '2026-02-14');
        expect(v.points[0].value?.toFixed(2)).toBe('50000.00');
        expect(v.totals.value?.toFixed(2)).toBe('50500.00');
        expect(v.totals.result?.toFixed(2)).toBe('500.00');
        expect(v.missingQuotes).toEqual([]);
        expect(v.estimatedIsins.sort()).toEqual(['US0079031078', 'USN070592100'].sort());
        expect(v.priceProvenance.get('US0079031078')).toBe('trade');
    });

    it('keeps offline valuation continuous across a same-ISIN split', () => {
        const transactions = [
            flow({
                id: 'buy',
                date: '2026-01-01',
                isin: 'ALPHABET',
                type: TransactionTypes.TradeBuy,
                quantity: new Decimal(1),
                price: new Decimal(1636),
                tradeCurrency: 'EUR',
                mutation: new Decimal(-1636),
            }),
            flow({
                id: 'split-sell',
                date: '2026-02-01',
                isin: 'ALPHABET',
                type: TransactionTypes.CorporateSell,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(1),
                price: new Decimal(0),
                tradeCurrency: 'EUR',
                rowIndex: 1,
            }),
            flow({
                id: 'split-buy',
                date: '2026-02-01',
                isin: 'ALPHABET',
                type: TransactionTypes.CorporateBuy,
                corporateAction: 'STOCK_SPLIT',
                quantity: new Decimal(20),
                price: new Decimal(0),
                tradeCurrency: 'EUR',
                rowIndex: 2,
            }),
        ];
        const valuation = buildValuation(transactions, new Map(), FX, '2026-02-02');

        expect(valuation.points.map((point) => point.value?.toFixed())).toEqual(['1636', '1636', '1636']);
        expect(valuation.totals.value?.toFixed()).toBe('1636');
    });

    it('values positions with the latest known quotes plus EUR cash via the balance anchor', () => {
        const v = buildValuation(
            miniLedger(),
            eurQuotes([
                ['US0079031078', '120'],
                ['USN070592100', '600'],
            ]),
            FX,
            '2026-02-14',
        );
        expect(v.points[1].value?.toFixed(2)).toBe('50440.00');
        expect(v.points[2].value?.toFixed(2)).toBe('50450.00');
        expect(v.points[3].value?.toFixed(2)).toBe('50750.00');
        expect(v.totals.cash.toFixed(2)).toBe('47750.00');
        expect(v.totals.result?.toFixed(2)).toBe('750.00');
        expect(v.totals.resultPct?.toFixed(4)).toBe('1.5000');
    });

    it('adds a today point after the latest transaction date', () => {
        const v = buildValuation(
            miniLedger(),
            eurQuotes([
                ['US0079031078', '120'],
                ['USN070592100', '600'],
            ]),
            FX,
            '2026-08-09',
        );
        expect(v.points[v.points.length - 1].date).toBe('2026-08-09');
        expect(v.totals.value?.toFixed(2)).toBe('50750.00');
    });

    it('uses the newest broker row as the cash anchor at an equal timestamp', () => {
        const valuation = buildValuation(
            [
                flow({ id: 'newer', rowIndex: 1, balance: new Decimal(100), balanceCurrency: 'EUR' }),
                flow({ id: 'older', rowIndex: 2, balance: new Decimal(50), balanceCurrency: 'EUR' }),
            ],
            new Map(),
            FX,
            '2026-02-14',
        );

        expect(valuation.totals.cash.toFixed()).toBe('100');
    });

    it('ignores future-dated transactions in a current valuation', () => {
        const valuation = buildValuation(
            [
                flow({
                    date: '2026-02-14',
                    type: TransactionTypes.Deposit,
                    mutation: new Decimal(100),
                    balance: new Decimal(100),
                    balanceCurrency: 'EUR',
                }),
                flow({
                    date: '2026-02-15',
                    type: TransactionTypes.Deposit,
                    mutation: new Decimal(900),
                    balance: new Decimal(1000),
                    balanceCurrency: 'EUR',
                }),
            ],
            new Map(),
            FX,
            '2026-02-14',
        );

        expect(valuation.totals.netInvested.toFixed()).toBe('100');
        expect(valuation.totals.cash.toFixed()).toBe('100');
    });

    it('counts costs and income in EUR', () => {
        const ledger = miniLedger();
        const v = buildValuation(ledger, new Map(), FX, '2026-02-14');
        expect(v.totals.costs.toFixed(2)).toBe('0.00');
        expect(v.totals.income.toFixed(2)).toBe('0.00');
    });

    it('empty ledger returns an empty series and zeroes', () => {
        const v = buildValuation([], new Map(), FX, '2026-08-09');
        expect(v.points).toEqual([]);
        expect(v.totals.netInvested.isZero()).toBe(true);
        expect(v.totals.value).toBeNull();
    });

    it('converts quotes in foreign currency via the fx-resolver', () => {
        const quotes = new Map<string, QuoteInput>([
            ['US0079031078', { price: new Decimal('120'), currency: 'USD' }],
            ['USN070592100', { price: new Decimal('600'), currency: 'EUR' }],
        ]);
        const fx = buildFxResolver([
            { pair: 'USD/EUR', date: '2026-02-13', rate: '0.9' },
            { pair: 'USD/EUR', date: '2026-02-14', rate: '0.8' },
        ]);
        const v = buildValuation(miniLedger(), quotes, fx, '2026-02-14');
        expect(v.points[2].value?.toFixed(2)).toBe('50270.00');
        expect(v.points[3].value?.toFixed(2)).toBe('50540.00');
        expect(v.missingFx).toEqual([]);
    });

    it('uses date-aware imported FX when market FX is unavailable', () => {
        const quotes = new Map<string, QuoteInput>([
            ['US0079031078', { price: new Decimal('120'), currency: 'USD' }],
            ['USN070592100', { price: new Decimal('600'), currency: 'EUR' }],
        ]);
        const v = buildValuation(miniLedger(), quotes, buildFxResolver([]), '2026-02-14');
        expect(v.totals.value?.toFixed(2)).toBe('50550.00');
        expect(v.totals.complete).toBe(true);
        expect(v.totals.result?.toFixed(2)).toBe('550.00');
        expect(v.missingFx).toEqual([]);
        expect(v.estimatedFx).toEqual(['USD/EUR']);
    });

    it('derives imported FX from linked settlement legs instead of trusting a malformed raw rate', () => {
        const orderId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const txns = [
            flow({
                id: 'usd-leg',
                date: '2026-01-01',
                type: TransactionTypes.FxCredit,
                mutation: new Decimal('905.45'),
                mutationCurrency: 'USD',
                fxRate: new Decimal('11.832'),
                orderId,
            }),
            flow({
                id: 'eur-leg',
                date: '2026-01-01',
                type: TransactionTypes.FxDebit,
                mutation: new Decimal('-765.23'),
                mutationCurrency: 'EUR',
                orderId,
            }),
            flow({
                id: 'cash',
                date: '2026-01-02',
                mutation: null,
                balance: new Decimal(1000),
                balanceCurrency: 'USD',
            }),
        ];

        const valuation = buildValuation(txns, new Map(), FX, '2026-01-02');

        expect(valuation.totals.cash.toFixed(2)).toBe('845.14');
        expect(valuation.estimatedFx).toEqual(['USD/EUR']);
    });

    it('uses the latest imported FX row for a later cash valuation fallback', () => {
        const txns = [
            flow({
                date: '2026-01-01',
                mutation: new Decimal(12),
                mutationCurrency: 'USD',
                fxRate: new Decimal('1.2'),
                balance: new Decimal(120),
                balanceCurrency: 'USD',
            }),
            flow({
                id: 'later-fx',
                date: '2026-02-01',
                mutation: new Decimal(15),
                mutationCurrency: 'USD',
                fxRate: new Decimal('1.5'),
            }),
        ];
        const v = buildValuation(txns, new Map(), FX, '2026-02-01');

        expect(v.totals.cash.toFixed(2)).toBe('80.00');
        expect(v.estimatedFx).toEqual(['USD/EUR']);
        expect(v.totals.complete).toBe(true);
    });

    it('does not invert an imported EUR rate for non-EUR reporting', () => {
        const txn = flow({
            balance: new Decimal(100),
            balanceCurrency: 'EUR',
            fxRate: new Decimal('1.2'),
        });
        const v = buildValuation([txn], new Map(), buildFxResolver([], 'USD'), txn.date, 'USD');

        expect(v.totals.cash.toFixed()).toBe('0');
        expect(v.totals.complete).toBe(false);
        expect(v.missingFx).toEqual(['EUR/USD']);
        expect(v.estimatedFx).toEqual([]);
    });

    it('marks missing FX on an external flow as valuation and result incomplete', () => {
        const txn = flow({
            type: TransactionTypes.Deposit,
            mutation: new Decimal(100),
            mutationCurrency: 'GBP',
        });
        const v = buildValuation([txn], new Map(), FX, txn.date);
        const totals = rangeTotals([txn], FX, null);

        expect(v.totals.complete).toBe(false);
        expect(v.totals.result).toBeNull();
        expect(v.nonReportingExternalFlows).toBe(1);
        expect(v.missingFx).toEqual(['GBP/EUR']);
        expect(totals.complete).toBe(false);
        expect(totals.missingFxExternalFlows).toBe(1);
    });

    it('converts non-EUR income to EUR via the fx-resolver', () => {
        const txns = [
            flow({
                type: TransactionTypes.Dividend,
                date: '2026-02-14',
                mutation: new Decimal('100'),
                mutationCurrency: 'USD',
            }),
        ];
        const fx = buildFxResolver([{ pair: 'USD/EUR', date: '2026-02-14', rate: '0.9' }]);
        const v = buildValuation(txns, new Map(), fx, '2026-02-14');
        expect(v.totals.income.toFixed(2)).toBe('90.00');
        expect(v.totals.incomePerCurrency.get('USD')?.toFixed(2)).toBe('100.00');
        expect(v.totals.missingFxIncome).toBe(0);
    });

    it('converts non-EUR costs to EUR via the fx-resolver', () => {
        const txns = [
            flow({
                type: TransactionTypes.TransactionFee,
                date: '2026-02-14',
                mutation: new Decimal('-50'),
                mutationCurrency: 'GBP',
            }),
        ];
        const fx = buildFxResolver([{ pair: 'GBP/EUR', date: '2026-02-14', rate: '1.15' }]);
        const v = buildValuation(txns, new Map(), fx, '2026-02-14');
        expect(v.totals.costs.toFixed(2)).toBe('-57.50');
        expect(v.totals.costsPerCurrency.get('GBP')?.toFixed(2)).toBe('-50.00');
        expect(v.totals.missingFxCosts).toBe(0);
    });

    it('skips non-EUR flows when no fx-rate is available', () => {
        const txns = [
            flow({
                type: TransactionTypes.Dividend,
                date: '2026-02-14',
                mutation: new Decimal('100'),
                mutationCurrency: 'USD',
            }),
        ];
        const v = buildValuation(txns, new Map(), buildFxResolver([]), '2026-02-14');
        expect(v.totals.income.toFixed(2)).toBe('0.00');
        expect(v.totals.incomePerCurrency.get('USD')?.toFixed(2)).toBe('100.00');
        expect(v.totals.missingFxIncome).toBe(1);
    });

    it('clamps oversold valuation quantity without creating a short market value', () => {
        const txns = [
            flow({
                id: 'buy',
                isin: 'TEST',
                type: TransactionTypes.TradeBuy,
                quantity: new Decimal(1),
                price: new Decimal(10),
                tradeCurrency: 'EUR',
                mutation: new Decimal(-10),
            }),
            flow({
                id: 'oversell',
                date: '2026-02-15',
                isin: 'TEST',
                type: TransactionTypes.TradeSell,
                quantity: new Decimal(2),
                price: new Decimal(20),
                tradeCurrency: 'EUR',
                mutation: new Decimal(40),
            }),
        ];
        const v = buildValuation(txns, eurQuotes([['TEST', '25']]), FX, '2026-02-15');

        expect(v.totals.value?.toFixed()).toBe('0');
        expect(v.totals.complete).toBe(true);
    });

    it('keeps known subtotals when one held instrument has no usable price', () => {
        const txns = [
            flow({
                isin: 'KNOWN',
                product: 'Known',
                type: TransactionTypes.TradeBuy,
                quantity: new Decimal(2),
                price: new Decimal(10),
                tradeCurrency: 'EUR',
                mutation: new Decimal(-20),
                mutationCurrency: 'EUR',
            }),
            flow({
                id: 'missing',
                isin: 'MISSING',
                product: 'Missing',
                type: TransactionTypes.TradeBuy,
                quantity: new Decimal(1),
                price: null,
                tradeCurrency: 'EUR',
                mutation: new Decimal(-5),
                mutationCurrency: 'EUR',
                rowIndex: 1,
            }),
        ];
        const v = buildValuation(txns, new Map(), FX, '2026-02-14');
        expect(v.totals.value?.toFixed(2)).toBe('20.00');
        expect(v.totals.complete).toBe(false);
        expect(v.missingQuotes).toEqual(['MISSING']);
        expect(v.totals.result).toBeNull();
    });

    it('exposes quote provenance and staleness and prefers it over a trade', () => {
        const txn = flow({
            isin: 'KNOWN',
            type: TransactionTypes.TradeBuy,
            quantity: new Decimal(1),
            price: new Decimal(10),
            tradeCurrency: 'EUR',
            mutation: new Decimal(-10),
        });
        const quotes = new Map<string, QuoteInput>([
            ['KNOWN', { price: new Decimal(12), currency: 'EUR', source: 'manual', date: '2026-02-13', stale: true }],
        ]);
        const v = buildValuation([txn], quotes, FX, '2026-02-14');
        expect(v.totals.value?.toFixed(2)).toBe('12.00');
        expect(v.priceProvenance.get('KNOWN')).toBe('manual');
        expect(v.staleIsins).toEqual(['KNOWN']);
        expect(v.estimatedIsins).toEqual([]);
    });

    it('uses imported transaction FX before market FX for range income', () => {
        const txn = flow({ mutation: new Decimal(120), mutationCurrency: 'USD', fxRate: new Decimal(1.2) });
        const r = rangeTotals([txn], buildFxResolver([{ pair: 'USD/EUR', date: txn.date, rate: '0.5' }]), null);
        expect(r.income.toFixed(2)).toBe('100.00');
    });
});

describe('rangeTotals', () => {
    it('counts only transactions within the cutoff', () => {
        const txns = [
            flow({
                type: TransactionTypes.Dividend,
                date: '2025-01-15',
                mutation: new Decimal('50'),
                mutationCurrency: 'EUR',
            }),
            flow({
                type: TransactionTypes.Dividend,
                date: '2026-02-14',
                mutation: new Decimal('100'),
                mutationCurrency: 'EUR',
            }),
            flow({
                type: TransactionTypes.TransactionFee,
                date: '2026-02-14',
                mutation: new Decimal('-5'),
                mutationCurrency: 'EUR',
            }),
        ];
        const r = rangeTotals(txns, buildFxResolver([]), '2026-01-01');
        expect(r.income.toFixed(2)).toBe('100.00');
        expect(r.costs.toFixed(2)).toBe('-5.00');
        expect(r.netInvested.toFixed(2)).toBe('0.00');
    });

    it('treats null cutoff as counting everything', () => {
        const txns = [
            flow({
                type: TransactionTypes.Dividend,
                date: '2025-01-15',
                mutation: new Decimal('50'),
                mutationCurrency: 'EUR',
            }),
            flow({
                type: TransactionTypes.Dividend,
                date: '2026-02-14',
                mutation: new Decimal('100'),
                mutationCurrency: 'EUR',
            }),
        ];
        const r = rangeTotals(txns, buildFxResolver([]), null);
        expect(r.income.toFixed(2)).toBe('150.00');
    });

    it('converts non-EUR income and tracks perCurrency', () => {
        const txns = [
            flow({
                type: TransactionTypes.Dividend,
                date: '2026-02-14',
                mutation: new Decimal('100'),
                mutationCurrency: 'USD',
            }),
        ];
        const fx = buildFxResolver([{ pair: 'USD/EUR', date: '2026-02-14', rate: '0.9' }]);
        const r = rangeTotals(txns, fx, null);
        expect(r.income.toFixed(2)).toBe('90.00');
        expect(r.incomePerCurrency.get('USD')?.toFixed(2)).toBe('100.00');
        expect(r.missingFxIncome).toBe(0);
    });

    it('skips non-EUR flows when no fx-rate is available', () => {
        const txns = [
            flow({
                type: TransactionTypes.TransactionFee,
                date: '2026-02-14',
                mutation: new Decimal('-50'),
                mutationCurrency: 'GBP',
            }),
        ];
        const r = rangeTotals(txns, buildFxResolver([]), null);
        expect(r.costs.toFixed(2)).toBe('0.00');
        expect(r.costsPerCurrency.get('GBP')?.toFixed(2)).toBe('-50.00');
        expect(r.missingFxCosts).toBe(1);
    });

    it('sums only EUR deposits/withdrawals as netInvested', () => {
        const txns = [
            flow({
                type: TransactionTypes.Deposit,
                date: '2026-01-01',
                mutation: new Decimal('1000'),
                mutationCurrency: 'EUR',
            }),
            flow({
                type: TransactionTypes.Withdrawal,
                date: '2026-02-01',
                mutation: new Decimal('-200'),
                mutationCurrency: 'EUR',
            }),
            flow({
                type: TransactionTypes.Deposit,
                date: '2026-03-01',
                mutation: new Decimal('500'),
                mutationCurrency: 'USD',
            }),
        ];
        const r = rangeTotals(txns, buildFxResolver([]), null);
        expect(r.netInvested.toFixed(2)).toBe('800.00');
    });
});

describe('buildValuation with USD as reporting currency', () => {
    const usdFx = buildFxResolver(
        [
            { pair: 'EUR/USD', date: '2021-01-01', rate: '1.2' },
            { pair: 'EUR/USD', date: '2026-02-14', rate: '1.1' },
        ],
        'USD',
    );

    it('converts EUR quotes and EUR cash to USD', () => {
        const quotes = new Map<string, QuoteInput>([
            ['US0079031078', { price: new Decimal('120'), currency: 'USD' }],
            ['USN070592100', { price: new Decimal('600'), currency: 'EUR' }],
        ]);
        const v = buildValuation(miniLedger(), quotes, usdFx, '2026-02-14', 'USD');
        expect(v.totals.cash.toFixed(2)).toBe('52450.00');
        expect(v.totals.value?.toFixed(2)).toBe('55630.00');
        expect(v.missingFx).toEqual([]);
    });

    it('reports missing fx with the reporting currency in the pair', () => {
        const quotes = new Map<string, QuoteInput>([['USN070592100', { price: new Decimal('600'), currency: 'EUR' }]]);
        const fx = buildFxResolver([{ pair: 'GBP/USD', date: '2026-02-14', rate: '1.3' }], 'USD');
        const v = buildValuation(miniLedger(), quotes, fx, '2026-02-14', 'USD');
        expect(v.totals.value?.toFixed(2)).toBe('600.00');
        expect(v.totals.complete).toBe(false);
        expect(v.missingFx).toContain('EUR/USD');
    });

    it('converts EUR income to USD and keeps USD income as-is', () => {
        const txns = [
            flow({
                type: TransactionTypes.Dividend,
                date: '2026-02-14',
                mutation: new Decimal('100'),
                mutationCurrency: 'EUR',
            }),
            flow({
                type: TransactionTypes.Dividend,
                date: '2026-02-14',
                mutation: new Decimal('50'),
                mutationCurrency: 'USD',
            }),
        ];
        const v = buildValuation(txns, new Map(), usdFx, '2026-02-14', 'USD');
        expect(v.totals.income.toFixed(2)).toBe('160.00');
    });

    it('converts foreign deposits into netInvested', () => {
        const txns = [
            flow({
                type: TransactionTypes.Deposit,
                date: '2026-01-01',
                mutation: new Decimal('1000'),
                mutationCurrency: 'EUR',
            }),
            flow({
                type: TransactionTypes.Deposit,
                date: '2026-01-02',
                mutation: new Decimal('500'),
                mutationCurrency: 'USD',
            }),
        ];
        const r = rangeTotals(txns, usdFx, null, null, 'USD');
        expect(r.netInvested.toFixed(2)).toBe('1700.00');
        const v = buildValuation(txns, new Map(), usdFx, '2026-01-02', 'USD');
        expect(v.totals.netInvested.toFixed(2)).toBe('1700.00');
        expect(v.nonReportingExternalFlows).toBe(0);
    });
});
