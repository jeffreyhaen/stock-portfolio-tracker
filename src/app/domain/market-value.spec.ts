import Decimal from 'decimal.js';
import { buildFxResolver } from './fx';
import { buildMarketValueSeries, PriceBar } from './market-value';
import { timeWeightedReturn } from './twr';
import { MINI_CSV } from '../../testing/seed';
import { parseCsv } from './csv/parse-csv';
import { repairCsvRows } from './csv/repair-csv-rows';
import { buildLedger } from './ledger';

function miniLedger() {
    return buildLedger(repairCsvRows(parseCsv(MINI_CSV).map((row) => row.slice(0, 12)))).transactions;
}

describe('buildFxResolver', () => {
    it('returns 1 for the reportingCurrency and the latest known rate for foreign currency', () => {
        const fx = buildFxResolver([
            { pair: 'USD/EUR', date: '2026-02-13', rate: '0.9' },
            { pair: 'USD/EUR', date: '2026-02-16', rate: '0.8' },
        ]);
        expect(fx('EUR', '2026-02-14')?.toFixed(0)).toBe('1');
        expect(fx('USD', '2026-02-14')?.toFixed(1)).toBe('0.9');
        expect(fx('USD', '2026-02-15')?.toFixed(1)).toBe('0.9');
        expect(fx('USD', '2026-02-17')?.toFixed(1)).toBe('0.8');
        expect(fx('USD', '2026-02-12')).toBeNull();
        expect(fx('GBP', '2026-02-14')).toBeNull();
    });
});

describe('buildMarketValueSeries', () => {
    const bars = new Map<string, PriceBar[]>([
        [
            'US0079031078',
            [
                { date: '2026-02-13', close: new Decimal('110'), currency: 'USD' },
                { date: '2026-02-16', close: new Decimal('120'), currency: 'USD' },
            ],
        ],
        ['USN070592100', [{ date: '2026-02-16', close: new Decimal('600'), currency: 'EUR' }]],
    ]);
    const fx = buildFxResolver([{ pair: 'USD/EUR', date: '2026-02-13', rate: '0.9' }]);

    it('values per trading day with the latest known close and fx', () => {
        const series = buildMarketValueSeries(miniLedger(), bars, fx);
        expect(series.points.map((p) => p.date)).toEqual(['2026-02-13', '2026-02-16']);
        const [day1, day2] = series.points;
        expect(day1.value?.toFixed(2)).toBe('50180.00');
        expect(day2.value?.toFixed(2)).toBe('50570.00');
        expect(series.missingFx).toEqual([]);
    });

    it('assigns the external flow and netInvested to the correct day', () => {
        const series = buildMarketValueSeries(miniLedger(), bars, fx);
        expect(series.points[0].netInvested.toFixed(2)).toBe('50000.00');
        expect(series.points[0].flow.isZero()).toBe(true);
    });

    it('marks market value incomplete when external-flow FX is missing', () => {
        const csv = [
            'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
            '01-01-2026,10:00,01-01-2026,,,iDEAL Deposit,,GBP,"100,00",,,,',
            '02-01-2026,10:00,02-01-2026,TEST,TEST,"Koop 1 @ 10,00 EUR",,EUR,"-10,00",EUR,"0,00",',
        ].join('\n');
        const ledger = buildLedger(repairCsvRows(parseCsv(csv).map((row) => row.slice(0, 12)))).transactions;
        const history = new Map([['TEST', [{ date: '2026-01-02', close: new Decimal(10), currency: 'EUR' }]]]);
        const series = buildMarketValueSeries(ledger, history, buildFxResolver([]));

        expect(series.points[0].value).toBeNull();
        expect(series.points[0].complete).toBe(false);
        expect(series.complete).toBe(false);
        expect(series.missingExternalFlows).toBe(1);
        expect(series.missingFx).toEqual(['GBP/EUR']);
    });

    it('clamps oversold quantities in historical market value', () => {
        const csv = [
            'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
            '01-01-2026,10:00,01-01-2026,TEST,TEST,"Koop 1 @ 10,00 EUR",,EUR,"-10,00",EUR,"0,00",',
            '02-01-2026,10:00,02-01-2026,TEST,TEST,"Verkoop 2 @ 20,00 EUR",,EUR,"40,00",EUR,"0,00",',
        ].join('\n');
        const ledger = buildLedger(repairCsvRows(parseCsv(csv).map((row) => row.slice(0, 12)))).transactions;
        const history = new Map([['TEST', [{ date: '2026-01-02', close: new Decimal(25), currency: 'EUR' }]]]);
        const series = buildMarketValueSeries(ledger, history, buildFxResolver([]));

        expect(series.points[0].value?.toFixed()).toBe('0');
    });

    it('falls back to the own trade price (anchor) when a position has no bar', () => {
        const asmlOnly = new Map<string, PriceBar[]>([
            ['USN070592100', [{ date: '2026-02-16', close: new Decimal('600'), currency: 'EUR' }]],
        ]);
        const series = buildMarketValueSeries(miniLedger(), asmlOnly, fx);
        expect(series.points[0].value?.toFixed(2)).toBe('50840.00');
        expect(series.estimatedIsins).toEqual(['US0079031078']);
    });
});

describe('split correction in buildMarketValueSeries', () => {
    const SPLIT_CSV = [
        'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
        '01-01-2021,10:00,01-01-2021,,,iDEAL Deposit,,EUR,"1000,00",EUR,"1000,00",',
        '02-01-2021,10:00,02-01-2021,FONDS,XX0000000001,"Koop 15 @ 10,00 EUR",,EUR,"-150,00",EUR,"850,00",aaaaaaaa-1111-1111-1111-111111111111',
        '03-01-2021,10:00,03-01-2021,FONDS,XX0000000001,"STOCK SPLIT: Verkoop 15 @ 10,00 EUR",,EUR,"0,00",EUR,"850,00",bbbbbbbb-1111-1111-1111-111111111111',
        '03-01-2021,10:01,03-01-2021,FONDS,XX0000000001,"STOCK SPLIT: Koop 1 @ 150,00 EUR",,EUR,"0,00",EUR,"850,00",cccccccc-1111-1111-1111-111111111111',
    ].join('\n');

    it('corrects pre-split quantities to split-adjusted quotes (value remains continuous)', () => {
        const ledger = buildLedger(repairCsvRows(parseCsv(SPLIT_CSV).map((row) => row.slice(0, 12)))).transactions;
        const bars = new Map<string, PriceBar[]>([
            [
                'XX0000000001',
                [
                    { date: '2021-01-02', close: new Decimal('150'), currency: 'EUR' },
                    { date: '2021-01-03', close: new Decimal('150'), currency: 'EUR' },
                ],
            ],
        ]);
        const splits = new Map([['XX0000000001', [{ date: '2021-01-03', factor: new Decimal(1).div(15) }]]]);
        const series = buildMarketValueSeries(ledger, bars, buildFxResolver([]), splits);
        expect(series.points.map((p) => p.value?.toFixed(2))).toEqual(['1000.00', '1000.00']);
    });

    it('corrects a synthetic split date when the broker books old and new ISINs afterwards', () => {
        const csv = [
            'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
            '01-01-2021,10:00,01-01-2021,,,iDEAL Deposit,,EUR,"1150,00",EUR,"1150,00",',
            '02-01-2021,10:00,02-01-2021,EXAMPLE OLD SHARES,XS0000000401,"Koop 15 @ 10,00 EUR",,EUR,"-150,00",EUR,"1000,00",',
            '14-05-2021,08:29,13-05-2021,EXAMPLE OLD SHARES,XS0000000401,"STOCK SPLIT: Verkoop 15 @ 10,00 EUR",,EUR,"0,00",EUR,"1000,00",',
            '14-05-2021,08:32,13-05-2021,EXAMPLE NEW SHARES,XS0000000402,"STOCK SPLIT: Koop 1 @ 150,00 EUR",,EUR,"0,00",EUR,"1000,00",',
        ].join('\n');
        const ledger = buildLedger(repairCsvRows(parseCsv(csv).map((row) => row.slice(0, 12)))).transactions;
        const bars = new Map<string, PriceBar[]>([
            [
                'XS0000000401',
                [
                    { date: '2021-05-12', close: new Decimal('150'), currency: 'EUR' },
                    { date: '2021-05-13', close: new Decimal('150'), currency: 'EUR' },
                    { date: '2021-05-14', close: new Decimal('150'), currency: 'EUR' },
                ],
            ],
            [
                'XS0000000402',
                [
                    { date: '2021-05-12', close: new Decimal('150'), currency: 'EUR' },
                    { date: '2021-05-13', close: new Decimal('150'), currency: 'EUR' },
                    { date: '2021-05-14', close: new Decimal('150'), currency: 'EUR' },
                ],
            ],
        ]);
        const splits = new Map([
            ['XS0000000401', [{ date: '2021-05-13', factor: new Decimal(1).div(15) }]],
            ['XS0000000402', [{ date: '2021-05-13', factor: new Decimal(1).div(15) }]],
        ]);
        const series = buildMarketValueSeries(ledger, bars, buildFxResolver([]), splits);
        expect(series.points.map((p) => p.value?.toFixed(2))).toEqual(['1150.00', '1150.00', '1150.00']);
    });
});

describe('timeWeightedReturn', () => {
    it('calculates TWR over daily values with external flows excluded', () => {
        const r = timeWeightedReturn([
            { date: '2026-01-01', value: new Decimal('1000'), flow: new Decimal('1000') },
            { date: '2026-01-02', value: new Decimal('1100'), flow: new Decimal('0') },
            { date: '2026-01-03', value: new Decimal('2150'), flow: new Decimal('1000') },
        ]);
        expect(r.twrPct?.toFixed(4)).toBe('12.6190');
        expect(r.days).toBe(2);
    });

    it('returns null when fewer than two value points', () => {
        const r = timeWeightedReturn([{ date: '2026-01-01', value: new Decimal('1000'), flow: new Decimal('0') }]);
        expect(r.twr).toBeNull();
        expect(r.days).toBe(0);
    });

    it('skips null values', () => {
        const r = timeWeightedReturn([
            { date: '2026-01-01', value: new Decimal('1000'), flow: new Decimal('0') },
            { date: '2026-01-02', value: null, flow: new Decimal('0') },
            { date: '2026-01-03', value: new Decimal('1100'), flow: new Decimal('0') },
        ]);
        expect(r.twrPct?.toFixed(2)).toBe('10.00');
    });

    it('skips zero-value days without flow (before the first transaction)', () => {
        const r = timeWeightedReturn([
            { date: '2020-03-02', value: new Decimal('0'), flow: new Decimal('0') },
            { date: '2020-03-03', value: new Decimal('0.4'), flow: new Decimal('0.4') },
            { date: '2020-03-04', value: new Decimal('1000'), flow: new Decimal('1000') },
            { date: '2020-03-05', value: new Decimal('1100'), flow: new Decimal('0') },
        ]);
        expect(r.twrPct?.toFixed(4)).toBe('9.9560');
    });
});
