import { Injectable } from '@angular/core';

const STORAGE_KEY = 'compare-history';
const MAX_ENTRIES = 10;

export interface StoredCompareHistoryEntry {
    readonly symbols: string[];
    readonly lastUsed: string;
}

function historyKey(symbols: string[]): string {
    return [...symbols].sort().join(',');
}

@Injectable({ providedIn: 'root' })
export class CompareHistoryService {
    list(): StoredCompareHistoryEntry[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw === null) {
                return [];
            }
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.filter(
                (entry): entry is StoredCompareHistoryEntry =>
                    typeof entry === 'object' &&
                    entry !== null &&
                    Array.isArray((entry as StoredCompareHistoryEntry).symbols) &&
                    (entry as StoredCompareHistoryEntry).symbols.every((symbol) => typeof symbol === 'string') &&
                    (entry as StoredCompareHistoryEntry).symbols.length > 0 &&
                    typeof (entry as StoredCompareHistoryEntry).lastUsed === 'string',
            );
        } catch {
            return [];
        }
    }

    record(symbols: string[]): void {
        if (symbols.length < 2) {
            return;
        }
        const key = historyKey(symbols);
        const rest = this.list().filter((entry) => historyKey(entry.symbols) !== key);
        this.save([{ symbols: [...symbols], lastUsed: new Date().toISOString() }, ...rest].slice(0, MAX_ENTRIES));
    }

    remove(symbols: string[]): void {
        const key = historyKey(symbols);
        this.save(this.list().filter((entry) => historyKey(entry.symbols) !== key));
    }

    clear(): void {
        this.save([]);
    }

    private save(entries: StoredCompareHistoryEntry[]): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        } catch {
            return;
        }
    }
}
