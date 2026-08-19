import Decimal from 'decimal.js';
import { parseLocalizedDate, parseLocalizedNumber } from './numbers';

describe('parseLocalizedNumber', () => {
    it.each([
        ['12345,67', '12345.67'],
        ['-250,00', '-250.00'],
        ['1.017', '1017'],
        ['6,4425', '6.4425'],
        ['15.265', '15265'],
        ['0,00', '0'],
        ['1.068,40', '1068.40'],
    ])('parses %s to %s', (input, expected) => {
        expect(parseLocalizedNumber(input).eq(new Decimal(expected))).toBe(true);
    });

    it('throws on invalid input', () => {
        expect(() => parseLocalizedNumber('abc')).toThrow('Invalid localized number');
        expect(() => parseLocalizedNumber('')).toThrow('Invalid localized number');
    });
});

describe('parseLocalizedDate', () => {
    it('converts dd-mm-yyyy to ISO', () => {
        expect(parseLocalizedDate('31-08-2025')).toBe('2025-08-31');
        expect(parseLocalizedDate('12-02-2026')).toBe('2026-02-12');
    });

    it('throws on invalid date', () => {
        expect(() => parseLocalizedDate('2025-08-31')).toThrow('Invalid date');
    });
});
