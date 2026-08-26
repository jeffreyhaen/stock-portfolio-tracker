import { Injectable, signal } from '@angular/core';

export type ReturnMetric = 'simple' | 'money-weighted';

const STORAGE_KEY = 'return-metric-preference';

@Injectable({ providedIn: 'root' })
export class ReturnMetricService {
    readonly metric = signal<ReturnMetric>(readStoredPreference());

    set(metric: ReturnMetric): void {
        this.metric.set(metric);
        try {
            localStorage.setItem(STORAGE_KEY, metric);
        } catch {
            // storage niet beschikbaar; voorkeur geldt alleen voor deze sessie
        }
    }
}

function readStoredPreference(): ReturnMetric {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === 'simple' || value === 'money-weighted') {
            return value;
        }
    } catch {
        // storage niet beschikbaar
    }
    return 'simple';
}
