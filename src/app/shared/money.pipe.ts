import { Pipe, PipeTransform } from '@angular/core';
import Decimal from 'decimal.js';

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
    transform(value: Decimal | string | number | null | undefined, currency: string | null | undefined): string {
        if (value === null || value === undefined || currency === null || currency === undefined || currency === '') {
            return '–';
        }
        try {
            const decimal = value instanceof Decimal ? value : new Decimal(value);
            if (decimal.isNaN()) {
                return '–';
            }
            return new Intl.NumberFormat('nl-NL', {
                style: 'currency',
                currency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(decimal.toNumber());
        } catch {
            return '–';
        }
    }
}
