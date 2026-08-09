import { Pipe, PipeTransform } from '@angular/core';
import Decimal from 'decimal.js';

@Pipe({ name: 'nlNumber', standalone: true })
export class NlNumberPipe implements PipeTransform {
    transform(
        value: Decimal | string | number | null | undefined,
        maxDecimals = 2,
        minDecimals: number | null = null,
    ): string {
        if (value === null || value === undefined) {
            return '–';
        }
        try {
            const decimal = value instanceof Decimal ? value : new Decimal(value);
            if (decimal.isNaN()) {
                return '–';
            }
            const min = minDecimals ?? maxDecimals;
            return new Intl.NumberFormat('nl-NL', {
                minimumFractionDigits: min,
                maximumFractionDigits: maxDecimals,
            }).format(decimal.toNumber());
        } catch {
            return '–';
        }
    }
}
