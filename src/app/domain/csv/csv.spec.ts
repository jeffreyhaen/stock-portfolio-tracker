import { parseCsv } from './parse-csv';
import { repairCsvRows } from './repair-csv-rows';

describe('parseCsv', () => {
    it('parses a simple csv', () => {
        expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
            ['a', 'b', 'c'],
            ['1', '2', '3'],
        ]);
    });

    it('handles quotes, commas and duplicate quotes', () => {
        expect(parseCsv('x,"1.234,56","with ""quote"""\n')).toEqual([['x', '1.234,56', 'with "quote"']]);
    });

    it('handles CRLF and BOM', () => {
        expect(parseCsv('﻿a,b\r\nc,d\r\n')).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });

    it('ignores empty lines', () => {
        expect(parseCsv('a,b\n\n\nc,d\n')).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });
});

describe('repairCsvRows', () => {
    const header = ['Datum', 'Tijd'];
    const base = [
        '06-02-2026',
        '16:10',
        '06-02-2026',
        'SYNTHETIC EQUITY',
        'XS0000000201',
        'Verkoop 1 @ 25,00 USD',
        '',
        'USD',
        '25,00',
        'USD',
        '25,00',
        '00000000-0000-4000-',
    ];

    it('leaves valid rows untouched (padded to 12 columns)', () => {
        const repaired = repairCsvRows([header, base]);
        expect(repaired[0][0]).toBe('Datum');
        expect(repaired[1]).toEqual(base);
    });

    it('recognizes the English DEGIRO header', () => {
        const englishHeader = [
            'Date',
            'Time',
            'Value date',
            'Product',
            'ISIN',
            'Description',
            'FX',
            'Change',
            '',
            'Balance',
            '',
            'Order Id',
        ];
        expect(repairCsvRows([englishHeader, base])).toEqual([englishHeader, base]);
    });

    it('recognizes a localized header from stable schema columns', () => {
        const localizedHeader = [
            'Localized date',
            'Localized time',
            'Localized value date',
            ' Product ',
            'isin',
            'Localized description',
            'FX',
            'Localized change',
            '',
            'Localized balance',
            '',
            'ORDER ID',
        ];
        expect(repairCsvRows([localizedHeader, base])).toEqual([localizedHeader, base]);
    });

    it('glues a split Order Id back together', () => {
        const continuation = ['', '', '', '', '', '', '', '', '', '', '', '8000-000000000201'];
        const [repaired] = repairCsvRows([base, continuation]);
        expect(repaired[11]).toBe('00000000-0000-4000-8000-000000000201');
    });

    it('glues a split description with a space', () => {
        const row = [...base];
        row[5] = 'Overboeking naar uw geldrekening bij flatexDEGIRO Bank:';
        const continuation = ['', '', '', '', '', '13,52 EUR', '', '', '', '', '', ''];
        const [repaired] = repairCsvRows([row, continuation]);
        expect(repaired[5]).toBe('Overboeking naar uw geldrekening bij flatexDEGIRO Bank: 13,52 EUR');
    });

    it('throws on corruption in an unexpected column', () => {
        const continuation = ['', '', '', 'FRAGMENT', '', '', '', '', '', '', '', ''];
        expect(() => repairCsvRows([base, continuation])).toThrow('Unexpected corruption in column 3');
    });

    it('throws when the csv starts with a continuation row', () => {
        const continuation = ['', '', '', '', '', 'rest', '', '', '', '', '', ''];
        expect(() => repairCsvRows([continuation])).toThrow('corrupted continuation row');
    });

    it('pads short rows to 12 columns', () => {
        const short = ['31-08-2025', '10:00'];
        const [repaired] = repairCsvRows([short]);
        expect(repaired).toHaveLength(12);
    });
});
