import Decimal from 'decimal.js';
import { compareSortPrimitives, TableSort } from './sort';

interface Rij {
    readonly name: string;
    readonly amount: Decimal | null;
}

const RIJEN: Rij[] = [
    { name: 'Beta', amount: new Decimal('20') },
    { name: 'Alpha', amount: null },
    { name: 'Gamma', amount: new Decimal('3') },
];

describe('compareSortPrimitives', () => {
    it('sorts nulls always to the end', () => {
        expect(compareSortPrimitives(null, 'a')).toBe(1);
        expect(compareSortPrimitives('a', null)).toBe(-1);
        expect(compareSortPrimitives(null, null)).toBe(0);
    });

    it('compares Decimals numerically', () => {
        expect(compareSortPrimitives(new Decimal('9'), new Decimal('10'))).toBeLessThan(0);
    });

    it('compares strings alphabetically', () => {
        expect(compareSortPrimitives('Alpha', 'Beta')).toBeLessThan(0);
    });
});

describe('TableSort', () => {
    it('applies the default sort', () => {
        const sort = new TableSort<'name' | 'amount', Rij>({ name: (r) => r.name, amount: (r) => r.amount }, 'name');
        expect(sort.apply(RIJEN).map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('keeps nulls at the end, also when sorting descending', () => {
        const sort = new TableSort<'name' | 'amount', Rij>(
            { name: (r) => r.name, amount: (r) => r.amount },
            'amount',
            'desc',
        );
        expect(sort.apply(RIJEN).map((r) => r.name)).toEqual(['Beta', 'Gamma', 'Alpha']);
    });

    it('switches direction when clicking the same column again', () => {
        const sort = new TableSort<'name' | 'amount', Rij>({ name: (r) => r.name, amount: (r) => r.amount }, 'name');
        sort.toggle('name');
        expect(sort.state()).toEqual({ key: 'name', direction: 'desc' });
        expect(sort.apply(RIJEN).map((r) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    });

    it('starts ascending on a new column', () => {
        const sort = new TableSort<'name' | 'amount', Rij>(
            { name: (r) => r.name, amount: (r) => r.amount },
            'amount',
            'desc',
        );
        sort.toggle('name');
        expect(sort.state()).toEqual({ key: 'name', direction: 'asc' });
    });
});
