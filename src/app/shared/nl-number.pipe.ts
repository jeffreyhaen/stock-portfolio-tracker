import { Pipe, PipeTransform } from '@angular/core';
import Decimal from 'decimal.js';

@Pipe({ name: 'nlNumber' })
export class NlNumberPipe implements PipeTransform {
    transform(value: Decimal | number | string | null | undefined, decimals = 2): string {
        if (value === null || value === undefined) {
            return '–';
        }
        try {
            const decimal = value instanceof Decimal ? value : new Decimal(value);
            if (decimal.isNaN()) {
                return '–';
            }
            return new Intl.NumberFormat('nl-NL', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            }).format(decimal.toNumber());
        } catch {
            return '–';
        }
    }
}
