import Decimal from 'decimal.js';

export function formatMoney(value: Decimal | string | number, currency: string): string {
    const decimal = value instanceof Decimal ? value : new Decimal(value);
    if (decimal.isNaN()) {
        throw new Error('geen geldig bedrag');
    }
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency,
        currencyDisplay: currency === 'USD' ? 'narrowSymbol' : 'symbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(decimal.toNumber());
}
