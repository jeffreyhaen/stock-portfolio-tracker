import Decimal from 'decimal.js';

export function parseLocalizedNumber(raw: string): Decimal {
    const trimmed = raw.trim();
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
        throw new Error(`Invalid localized number: "${raw}"`);
    }
    return new Decimal(normalized);
}

export function parseLocalizedDate(raw: string): string {
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw.trim());
    if (!match) {
        throw new Error(`Invalid date: "${raw}"`);
    }
    return `${match[3]}-${match[2]}-${match[1]}`;
}
