export function parseCsv(text: string): string[][] {
    const source = text.replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    let i = 0;

    while (i < source.length) {
        const char = source[i];
        if (inQuotes) {
            if (char === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && source[i + 1] === '\n') {
                i += 1;
            }
            row.push(field);
            field = '';
            if (row.length > 1 || row[0] !== '') {
                rows.push(row);
            }
            row = [];
        } else {
            field += char;
        }
        i += 1;
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
