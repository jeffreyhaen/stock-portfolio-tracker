import { Signal, WritableSignal, signal } from '@angular/core';
import Decimal from 'decimal.js';

export type SortDirection = 'asc' | 'desc';
export type SortPrimitive = string | number | Decimal | null;

export interface SortState<K extends string = string> {
    readonly key: K;
    readonly direction: SortDirection;
}

export interface SortController {
    readonly state: Signal<SortState>;
    toggle(key: string): void;
}

export function compareSortPrimitives(a: SortPrimitive, b: SortPrimitive): number {
    if (a === null) {
        return b === null ? 0 : 1;
    }
    if (b === null) {
        return -1;
    }
    if (a instanceof Decimal && b instanceof Decimal) {
        return a.comparedTo(b);
    }
    if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
    }
    return String(a).localeCompare(String(b), 'nl-NL');
}

export class TableSort<K extends string, T> implements SortController {
    private readonly stateSignal: WritableSignal<SortState<K>>;
    readonly state: Signal<SortState<K>>;

    constructor(
        private readonly accessors: Record<K, (row: T) => SortPrimitive>,
        defaultKey: K,
        defaultDirection: SortDirection = 'asc',
    ) {
        this.stateSignal = signal({ key: defaultKey, direction: defaultDirection });
        this.state = this.stateSignal.asReadonly();
    }

    toggle(key: K): void {
        this.stateSignal.update((current) =>
            current.key === key
                ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                : { key, direction: 'asc' },
        );
    }

    apply(rows: readonly T[]): T[] {
        const { key, direction } = this.stateSignal();
        const accessor = this.accessors[key];
        const factor = direction === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const waardeA = accessor(a);
            const waardeB = accessor(b);
            if (waardeA === null || waardeB === null) {
                return compareSortPrimitives(waardeA, waardeB);
            }
            return factor * compareSortPrimitives(waardeA, waardeB);
        });
    }
}
