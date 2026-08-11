import { Pipe, PipeTransform } from '@angular/core';
import Decimal from 'decimal.js';
import { formatMoney } from './money';

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
    transform(value: Decimal | string | number | null | undefined, currency: string | null | undefined): string {
        if (value === null || value === undefined || currency === null || currency === undefined || currency === '') {
            return '–';
        }
        try {
            return formatMoney(value, currency);
        } catch {
            return '–';
        }
    }
}
