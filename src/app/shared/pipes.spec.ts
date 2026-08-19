import Decimal from 'decimal.js';
import { MoneyPipe } from './money.pipe';
import { LocalizedDatePipe } from './localized-date.pipe';

describe('MoneyPipe', () => {
    const pipe = new MoneyPipe();

    it.each([
        [new Decimal('12345.67'), 'EUR', '€\u00a012.345,67'],
        [new Decimal('1068.40'), 'USD', '$\u00a01.068,40'],
        [new Decimal('1068.40'), 'CAD', 'C$\u00a01.068,40'],
        [new Decimal('1068.40'), 'AUD', 'AU$\u00a01.068,40'],
        [new Decimal('-750'), 'EUR', '€\u00a0-750,00'],
    ])('formats %s %s to %s', (value, currency, expected) => {
        expect(pipe.transform(value, currency)).toBe(expected);
    });

    it('formats null/empty currency as a dash', () => {
        expect(pipe.transform(null, 'EUR')).toBe('–');
        expect(pipe.transform(new Decimal(5), '')).toBe('–');
        expect(pipe.transform('onzin', 'EUR')).toBe('–');
    });
});

describe('LocalizedDatePipe', () => {
    const pipe = new LocalizedDatePipe();

    it('formats iso to dd-mm-yyyy', () => {
        expect(pipe.transform('2026-02-12')).toBe('12-02-2026');
    });

    it('formats null as a dash', () => {
        expect(pipe.transform(null)).toBe('–');
    });
});
