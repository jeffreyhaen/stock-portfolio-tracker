import { effect, inject, Injectable, signal } from '@angular/core';
import { PortfolioDatabase } from './db';
import { PortfolioContext } from './portfolio-context';

export interface StoredForecastSettings {
    readonly years: number | null;
    readonly annualReturnPct: string | null;
    readonly monthlyContribution: string | null;
    readonly benchmarkAnnualReturnPct: string | null;
}

export const DEFAULT_FORECAST_YEARS = 10;

function settingKey(portfolioId: string): string {
    return `forecast:${portfolioId}`;
}

function parseSettings(value: string | undefined): StoredForecastSettings | null {
    if (value === undefined) {
        return null;
    }
    try {
        const raw = JSON.parse(value) as Partial<StoredForecastSettings>;
        return {
            years: typeof raw.years === 'number' ? raw.years : null,
            annualReturnPct: typeof raw.annualReturnPct === 'string' ? raw.annualReturnPct : null,
            monthlyContribution: typeof raw.monthlyContribution === 'string' ? raw.monthlyContribution : null,
            benchmarkAnnualReturnPct:
                typeof raw.benchmarkAnnualReturnPct === 'string' ? raw.benchmarkAnnualReturnPct : null,
        };
    } catch {
        return null;
    }
}

/** Persists forecast assumptions per portfolio through the settings store. */
@Injectable({ providedIn: 'root' })
export class ForecastService {
    private readonly db = inject(PortfolioDatabase);
    private readonly context = inject(PortfolioContext);

    private readonly settingsState = signal<StoredForecastSettings | null>(null);
    private readonly readyState = signal(false);

    readonly settings = this.settingsState.asReadonly();
    readonly settingsReady = this.readyState.asReadonly();

    constructor() {
        effect(() => {
            const portfolioId = this.context.selectedPortfolioId();
            this.settingsState.set(null);
            this.readyState.set(false);
            void this.load(portfolioId);
        });
    }

    async save(settings: StoredForecastSettings): Promise<void> {
        const portfolioId = this.context.selectedPortfolioId();
        if (portfolioId === '') {
            return;
        }
        await this.db.settings.put({ key: settingKey(portfolioId), value: JSON.stringify(settings) });
        this.settingsState.set(settings);
        this.readyState.set(true);
    }

    private async load(portfolioId: string): Promise<void> {
        if (portfolioId === '') {
            this.readyState.set(true);
            return;
        }
        const stored = parseSettings((await this.db.settings.get(settingKey(portfolioId)))?.value);
        if (this.context.selectedPortfolioId() !== portfolioId) {
            return;
        }
        this.settingsState.set(stored);
        this.readyState.set(true);
    }
}
