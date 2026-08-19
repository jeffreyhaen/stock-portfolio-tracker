import Decimal from 'decimal.js';
import { LocalizedNumberPipe } from './localized-number.pipe';

describe('LocalizedNumberPipe', () => {
    const pipe = new LocalizedNumberPipe();

    it.each([
        [new Decimal('12345.67'), 2, '12.345,67'],
        ['98765.43', 2, '98.765,43'],
        [3579, 0, '3.579'],
        [new Decimal('-750'), 2, '-750,00'],
    ])('formats %s to %s', (value, decimals, expected) => {
        expect(pipe.transform(value, decimals)).toBe(expected);
    });

    it('formats null/NaN as a dash', () => {
        expect(pipe.transform(null)).toBe('–');
        expect(pipe.transform('geen-getal')).toBe('–');
    });
});
