const DATE_PATTERN = /^\d{2}-\d{2}-\d{4}$/;
const DESCRIPTION_COLUMN = 5;
const ORDER_ID_COLUMN = 11;

export function isDataRowStart(row: readonly string[]): boolean {
    return DATE_PATTERN.test(row[0] ?? '');
}

function normalizedHeaderCell(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase();
}

export function isHeaderRow(row: readonly string[]): boolean {
    const firstPair = `${normalizedHeaderCell(row[0])}|${normalizedHeaderCell(row[1])}`;
    return (
        firstPair === 'datum|tijd' ||
        firstPair === 'date|time' ||
        (normalizedHeaderCell(row[3]) === 'product' &&
            normalizedHeaderCell(row[4]) === 'isin' &&
            normalizedHeaderCell(row[11]) === 'order id')
    );
}

export function repairCsvRows(rows: readonly string[][], columnCount = 12): string[][] {
    const repaired: string[][] = [];
    for (const raw of rows) {
        const row = [...raw];
        while (row.length < columnCount) {
            row.push('');
        }
        if (isDataRowStart(row) || isHeaderRow(row)) {
            repaired.push(row);
            continue;
        }
        const previous = repaired[repaired.length - 1];
        if (!previous) {
            throw new Error(`CSV starts with a corrupted continuation row: ${row.join('|')}`);
        }
        row.forEach((fragment, column) => {
            const clean = fragment.trim();
            if (!clean) {
                return;
            }
            if (column === DESCRIPTION_COLUMN) {
                previous[column] = `${previous[column]} ${clean}`.trim();
            } else if (column === ORDER_ID_COLUMN) {
                previous[column] = `${previous[column]}${clean}`;
            } else {
                throw new Error(
                    `Unexpected corruption in column ${column} ("${clean}") after row "${previous[0]} ${previous[5]}"`,
                );
            }
        });
    }
    return repaired;
}
