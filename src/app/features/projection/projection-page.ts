import { Component, computed, effect, inject, signal } from '@angular/core';
import Decimal from 'decimal.js';
import { FundamentalsResult, QuoteResult, TickerSuggestion } from '../../data/market-data-provider';
import { ProjectionOverviewRow, ProjectionService } from '../../data/projection.service';
import { StoredProjectionModel, StoredProjectionSnapshot } from '../../data/stored-types';
import {
    buildProjection,
    ProjectionModel,
    ProjectionScenario,
    ProjectionScenarioRow,
    projectionValidationError,
    ProjectionYearResult,
    PROJECTION_MAX_PROJECTED_YEARS,
    resolveProjectionInputs,
} from '../../domain/projection';

import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { MoneyPipe } from '../../shared/money.pipe';
import { themeColor } from '../../shared/theme-colors';
import { ThemeService } from '../../shared/theme.service';
import { TickerSearchComponent } from '../../shared/ui/ticker-search';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

const DEFAULT_PROJECTED_YEARS = 4;
const DEFAULT_GROWTH_PCT = new Decimal(10);
const FALLBACK_PE_LOW = new Decimal(15);
const FALLBACK_PE_HIGH = new Decimal(25);
const SAVE_DEBOUNCE_MS = 800;

interface ScenarioDraft {
    name: string;
    growth: string[];
    margin: string[];
    peLow: string[];
    peHigh: string[];
}

interface ModelDrafts {
    baseYear: string;
    baseRevenue: string;
    baseNetIncome: string;
    currentPrice: string;
    sharesOutstanding: string;
    currency: string;
    projectedYears: string;
    scenarios: ScenarioDraft[];
}

@Component({
    selector: 'app-projection-page',
    imports: [MoneyPipe, LocalizedNumberPipe, LocalizedDatePipe, TickerSearchComponent, ValueChartComponent],
    templateUrl: './projection-page.html',
})
export class ProjectionPage {
    private readonly theme = inject(ThemeService);
    readonly projectionService = inject(ProjectionService);

    readonly maxProjectedYears = PROJECTION_MAX_PROJECTED_YEARS;

    readonly symbol = signal<string | null>(null);
    readonly fundamentals = signal<FundamentalsResult | null>(null);
    readonly quote = signal<QuoteResult | null>(null);
    readonly drafts = signal<ModelDrafts | null>(null);
    readonly activeScenario = signal(0);
    readonly addingScenario = signal(false);
    readonly newScenarioName = signal('');
    readonly snapshots = signal<StoredProjectionSnapshot[]>([]);
    readonly viewingSnapshot = signal<StoredProjectionSnapshot | null>(null);
    readonly overview = signal<ProjectionOverviewRow[]>([]);
    readonly saved = signal(false);

    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        void this.refreshOverview();
        effect(() => {
            const drafts = this.drafts();
            if (drafts === null || this.symbol() === null) {
                return;
            }
            const model = this.parsedModel();
            if (model === null) {
                return;
            }
            if (this.saveTimer !== null) {
                clearTimeout(this.saveTimer);
            }
            this.saveTimer = setTimeout(() => {
                this.saveTimer = null;
                void this.projectionService.saveModel(model).then(() => this.saved.set(true));
            }, SAVE_DEBOUNCE_MS);
        });
    }

    readonly currency = computed(() => {
        const fundamentals = this.fundamentals();
        if (fundamentals !== null) {
            return fundamentals.currency;
        }
        const quoteCurrency = this.quote()?.currency ?? null;
        if (quoteCurrency !== null && quoteCurrency !== '') {
            return quoteCurrency;
        }
        return (this.drafts()?.currency ?? '').trim().toUpperCase();
    });

    readonly longName = computed(() => this.fundamentals()?.longName ?? null);

    readonly livePrice = computed<Decimal | null>(() => {
        const manual = this.drafts()?.currentPrice ?? '';
        if (manual.trim() !== '') {
            const parsed = this.parseDecimal(manual);
            if (parsed !== null) {
                return parsed;
            }
        }
        const quote = this.quote();
        return quote === null ? null : new Decimal(quote.price);
    });

    readonly liveShares = computed<Decimal | null>(() => {
        const manual = this.drafts()?.sharesOutstanding ?? '';
        if (manual.trim() !== '') {
            const parsed = this.parseDecimal(manual);
            if (parsed !== null) {
                return parsed;
            }
        }
        const shares = this.fundamentals()?.sharesOutstanding ?? null;
        return shares === null ? null : new Decimal(shares);
    });

    readonly displayPrice = computed(() => this.livePrice());

    readonly marginTtmPct = computed<Decimal | null>(() => {
        const margin = this.fundamentals()?.marginTtm ?? null;
        return margin === null ? null : new Decimal(margin).times(100);
    });

    /** Green/red by sign for financial percentages; empty when not available. */
    signClass(pct: Decimal | null | undefined): string {
        if (pct === null || pct === undefined) {
            return '';
        }
        return pct.isNegative() ? 'text-error' : 'text-success';
    }

    /** Every editable field as text; mirrors the persisted model so inputs round-trip. */
    readonly parsedModel = computed<ProjectionModel | null>(() => {
        const drafts = this.drafts();
        if (drafts === null) {
            return null;
        }
        const baseYear = Number(drafts.baseYear);
        const projectedYears = Number(drafts.projectedYears);
        const baseRevenue = this.parseDecimal(drafts.baseRevenue);
        const baseNetIncome = this.parseDecimal(drafts.baseNetIncome);
        if (
            !Number.isInteger(baseYear) ||
            !Number.isInteger(projectedYears) ||
            baseRevenue === null ||
            baseNetIncome === null
        ) {
            return null;
        }
        const scenarios: ProjectionScenario[] = [];
        for (const scenario of drafts.scenarios) {
            if (
                scenario.growth.length !== projectedYears + 1 ||
                scenario.margin.length !== projectedYears + 1 ||
                scenario.peLow.length !== projectedYears + 1 ||
                scenario.peHigh.length !== projectedYears + 1
            ) {
                return null;
            }
            const rows: ProjectionScenarioRow[] = [];
            for (let i = 0; i <= projectedYears; i++) {
                const peLow = this.parseDecimal(scenario.peLow[i]);
                const peHigh = this.parseDecimal(scenario.peHigh[i]);
                if (peLow === null || peHigh === null) {
                    return null;
                }
                if (i === 0) {
                    rows.push({ revenueGrowthPct: null, netMarginPct: null, peLow, peHigh });
                } else {
                    const growth = this.parseDecimal(scenario.growth[i]);
                    const margin = this.parseDecimal(scenario.margin[i]);
                    if (growth === null || margin === null) {
                        return null;
                    }
                    rows.push({ revenueGrowthPct: growth, netMarginPct: margin, peLow, peHigh });
                }
            }
            scenarios.push({ name: scenario.name, rows });
        }
        if (scenarios.length === 0) {
            return null;
        }
        return {
            symbol: this.symbol() ?? '',
            baseYear,
            baseRevenue,
            baseNetIncome,
            currentPrice: this.parseDecimal(drafts.currentPrice),
            sharesOutstanding: this.parseDecimal(drafts.sharesOutstanding),
            currency: drafts.currency.trim().toUpperCase(),
            projectedYears,
            scenarios,
        };
    });

    private readonly resolvedPerScenario = computed(() => {
        const model = this.parsedModel();
        if (model === null) {
            return null;
        }
        return resolveProjectionInputs(model, { currentPrice: this.livePrice(), sharesOutstanding: this.liveShares() });
    });

    readonly scenarioNames = computed(() => this.drafts()?.scenarios.map((s) => s.name) ?? []);

    readonly activeDrafts = computed<ScenarioDraft | null>(() => {
        const drafts = this.drafts();
        return drafts?.scenarios[this.activeScenario()] ?? null;
    });

    readonly activeResults = computed(() => {
        if (this.viewingSnapshot() !== null) {
            return this.snapshotResults();
        }
        const inputs = this.resolvedPerScenario();
        const index = this.activeScenario();
        if (inputs === null || inputs[index] === undefined) {
            return null;
        }
        try {
            return buildProjection(inputs[index]);
        } catch {
            return null;
        }
    });

    readonly modelError = computed<string | null>(() => {
        if (this.viewingSnapshot() !== null) {
            return null;
        }
        const drafts = this.drafts();
        if (drafts === null) {
            return 'Pick a symbol to start a projection.';
        }
        const model = this.parsedModel();
        if (model === null) {
            return 'Enter valid numbers for every field.';
        }
        const inputs = this.resolvedPerScenario();
        if (inputs === null) {
            return 'No share count available: enter shares outstanding manually or enable the market-data proxy.';
        }
        const active = inputs[this.activeScenario()];
        if (active === undefined) {
            return 'Select a valid scenario.';
        }
        return projectionValidationError(active);
    });

    readonly negativeEarnings = computed(() => {
        const drafts = this.drafts();
        if (drafts === null) {
            return false;
        }
        const netIncome = this.parseDecimal(drafts.baseNetIncome);
        return netIncome !== null && netIncome.lt(0);
    });

    readonly offline = computed(() => {
        return this.fundamentals() === null && this.quote() === null && this.symbol() !== null;
    });

    readonly chartSeries = computed<ChartSeries[]>(() => {
        this.theme.theme();
        const results = this.activeResults();
        if (results === null) {
            return [];
        }
        const toPoints = (pick: (result: ProjectionYearResult) => Decimal) =>
            results.map((result) => ({ time: `${result.year}-12-31`, value: pick(result).toNumber() }));
        return [
            {
                name: 'Low case',
                color: themeColor('--color-chart-benchmark', '#94a3b8'),
                dashed: false,
                fill: false,
                points: toPoints((result) => result.priceLow),
            },
            {
                name: 'High case',
                color: themeColor('--color-chart-line', '#0068f0'),
                dashed: false,
                fill: false,
                points: toPoints((result) => result.priceHigh),
            },
        ];
    });

    readonly snapshotResults = computed(() => {
        const snapshot = this.viewingSnapshot();
        if (snapshot === null) {
            return null;
        }
        try {
            return buildProjectionForModel(snapshot.model);
        } catch {
            return null;
        }
    });

    readonly snapshotError = computed<string | null>(() => {
        const snapshot = this.viewingSnapshot();
        if (snapshot === null) {
            return null;
        }
        try {
            const results = buildProjectionForModel(snapshot.model);
            return results === null ? 'This snapshot has incomplete inputs and cannot be recomputed.' : null;
        } catch (error) {
            return String((error as Error).message ?? error);
        }
    });

    readonly snapshotsEmpty = computed(() => this.snapshots().length === 0);

    private async refreshOverview(): Promise<void> {
        this.overview.set(await this.projectionService.listOverview());
    }

    async pickSymbol(suggestion: TickerSuggestion): Promise<void> {
        const symbol = suggestion.symbol.trim().toUpperCase();
        this.symbol.set(symbol);
        this.viewingSnapshot.set(null);
        this.activeScenario.set(0);
        this.fundamentals.set(this.projectionService.cachedFundamentals(symbol));
        this.quote.set(null);

        const [model, fundamentals, quote, snapshots] = await Promise.all([
            this.projectionService.loadModel(symbol),
            this.projectionService.loadFundamentals(symbol),
            this.projectionService.loadQuote(symbol),
            this.projectionService.listSnapshots(symbol),
        ]);
        if (this.symbol() !== symbol) {
            return;
        }
        this.fundamentals.set(fundamentals);
        this.quote.set(quote);
        this.snapshots.set(snapshots);
        if (model !== null) {
            this.drafts.set(draftsFromModel(model));
        } else {
            this.drafts.set(this.defaultDrafts(fundamentals));
        }
    }

    async clearSymbol(): Promise<void> {
        this.symbol.set(null);
        this.fundamentals.set(null);
        this.quote.set(null);
        this.drafts.set(null);
        this.snapshots.set([]);
        this.viewingSnapshot.set(null);
        this.activeScenario.set(0);
        await this.refreshOverview();
    }

    setActiveScenario(index: number): void {
        if (this.viewingSnapshot() !== null) {
            this.viewingSnapshot.set(null);
        }
        this.activeScenario.set(index);
    }

    openScenarioEditor(): void {
        this.newScenarioName.set(this.nextScenarioName());
        this.addingScenario.set(true);
    }

    confirmAddScenario(): void {
        const name = this.newScenarioName().trim();
        const drafts = this.drafts();
        if (drafts === null || name === '' || drafts.scenarios.some((s) => s.name === name)) {
            this.addingScenario.set(false);
            return;
        }
        const columns = Number(drafts.projectedYears) + 1;
        const template = drafts.scenarios[Math.min(this.activeScenario(), drafts.scenarios.length - 1)];
        const clone: ScenarioDraft = {
            name,
            growth: [...template.growth],
            margin: [...template.margin],
            peLow: [...template.peLow],
            peHigh: [...template.peHigh],
        };
        if (template.growth.length !== columns) {
            return;
        }
        this.drafts.set({ ...drafts, scenarios: [...drafts.scenarios, clone] });
        this.addingScenario.set(false);
        this.activeScenario.set(drafts.scenarios.length);
    }

    cancelAddScenario(): void {
        this.addingScenario.set(false);
    }

    removeScenario(index: number): void {
        const drafts = this.drafts();
        if (drafts === null || drafts.scenarios.length <= 1) {
            return;
        }
        const scenarios = drafts.scenarios.filter((_, i) => i !== index);
        this.drafts.set({ ...drafts, scenarios });
        this.activeScenario.set(Math.max(0, Math.min(this.activeScenario(), scenarios.length - 1)));
    }

    setProjectedYears(value: string): void {
        const drafts = this.drafts();
        if (drafts === null) {
            return;
        }
        const years = Number(value);
        if (!Number.isInteger(years) || years < 1 || years > this.maxProjectedYears) {
            return;
        }
        this.drafts.set({
            ...drafts,
            projectedYears: String(years),
            scenarios: drafts.scenarios.map((scenario) => this.resizeScenario(scenario, years + 1)),
        });
    }

    setDraft(
        field: 'baseYear' | 'baseRevenue' | 'baseNetIncome' | 'currentPrice' | 'sharesOutstanding' | 'currency',
        value: string,
    ): void {
        const drafts = this.drafts();
        if (drafts === null) {
            return;
        }
        this.drafts.set({ ...drafts, [field]: value });
    }

    setCell(
        scenarioIndex: number,
        field: 'growth' | 'margin' | 'peLow' | 'peHigh',
        column: number,
        value: string,
    ): void {
        const drafts = this.drafts();
        if (drafts === null || drafts.scenarios[scenarioIndex] === undefined) {
            return;
        }
        const scenarios = drafts.scenarios.map((scenario, index) => {
            if (index !== scenarioIndex) {
                return scenario;
            }
            if (scenario[field][column] === undefined) {
                return scenario;
            }
            const values = [...scenario[field]];
            values[column] = value;
            return { ...scenario, [field]: values };
        });
        this.drafts.set({ ...drafts, scenarios });
    }

    applyGrowthToAll(scenarioIndex: number): void {
        this.copyFirstProjectedValue(scenarioIndex, 'growth');
    }

    applyMarginToAll(scenarioIndex: number): void {
        this.copyFirstProjectedValue(scenarioIndex, 'margin');
    }

    applyPeLowToAll(scenarioIndex: number): void {
        this.copyFirstProjectedValue(scenarioIndex, 'peLow');
    }

    applyPeHighToAll(scenarioIndex: number): void {
        this.copyFirstProjectedValue(scenarioIndex, 'peHigh');
    }

    resetBaseFromFundamentals(): void {
        const fundamentals = this.fundamentals();
        if (fundamentals === null) {
            return;
        }
        const drafts = this.drafts();
        if (drafts === null) {
            return;
        }
        const baseYear = fundamentals.fiscalYearEnd !== null ? Number(fundamentals.fiscalYearEnd.slice(0, 4)) : null;
        const revenue = fundamentals.revenueFy ?? fundamentals.revenueTtm;
        const netIncome = fundamentals.netIncomeFy;
        this.drafts.set({
            ...drafts,
            baseYear: baseYear !== null && Number.isInteger(baseYear) ? String(baseYear) : drafts.baseYear,
            baseRevenue: revenue ?? drafts.baseRevenue,
            baseNetIncome: netIncome ?? drafts.baseNetIncome,
            currentPrice: '',
            sharesOutstanding: '',
        });
    }

    async saveSnapshot(): Promise<void> {
        const symbol = this.symbol();
        const model = this.parsedModel();
        if (symbol === null || model === null) {
            return;
        }
        await this.projectionService.saveSnapshot(symbol, this.currency(), this.longName(), model);
        this.snapshots.set(await this.projectionService.listSnapshots(symbol));
        await this.refreshOverview();
    }

    viewSnapshot(snapshot: StoredProjectionSnapshot): void {
        this.viewingSnapshot.set(snapshot);
    }

    backToCurrent(): void {
        this.viewingSnapshot.set(null);
    }

    async deleteSnapshot(snapshot: StoredProjectionSnapshot): Promise<void> {
        if (snapshot.id === undefined) {
            return;
        }
        await this.projectionService.deleteSnapshot(snapshot.id);
        this.snapshots.set(await this.projectionService.listSnapshots(snapshot.symbol));
        if (this.viewingSnapshot()?.id === snapshot.id) {
            this.viewingSnapshot.set(null);
        }
        await this.refreshOverview();
    }

    openOverviewSymbol(row: ProjectionOverviewRow): void {
        void this.pickSymbol({ symbol: row.symbol, name: row.longName ?? '', exchange: '' });
    }

    snapshotAssumptionsLabel(snapshot: StoredProjectionSnapshot): string {
        return storedModelAssumptionsLabel(snapshot.model);
    }

    overviewEndPrice(row: ProjectionOverviewRow, which: 'low' | 'high'): Decimal | null {
        const snapshot = row.latestSnapshot;
        if (snapshot === null) {
            return null;
        }
        try {
            const last = buildProjectionForModel(snapshot.model)?.at(-1);
            if (last === undefined) {
                return null;
            }
            return which === 'low' ? last.priceLow : last.priceHigh;
        } catch {
            return null;
        }
    }

    snapshotEndPrice(snapshot: StoredProjectionSnapshot, which: 'low' | 'high'): Decimal | null {
        try {
            const last = buildProjectionForModel(snapshot.model)?.at(-1);
            if (last === undefined) {
                return null;
            }
            return which === 'low' ? last.priceLow : last.priceHigh;
        } catch {
            return null;
        }
    }

    private copyFirstProjectedValue(scenarioIndex: number, field: 'growth' | 'margin' | 'peLow' | 'peHigh'): void {
        const drafts = this.drafts();
        const scenario = drafts?.scenarios[scenarioIndex];
        if (drafts === undefined || drafts === null || scenario === undefined) {
            return;
        }
        const values = [...scenario[field]];
        if (values[1] === undefined || this.parseDecimal(values[1]) === null) {
            return;
        }
        for (let i = 1; i < values.length; i++) {
            values[i] = values[1];
        }
        const scenarios = drafts.scenarios.map((item, index) =>
            index === scenarioIndex ? { ...item, [field]: values } : item,
        );
        this.drafts.set({ ...drafts, scenarios });
    }

    private resizeScenario(scenario: ScenarioDraft, columns: number): ScenarioDraft {
        const resize = (values: string[], fill: (index: number) => string): string[] => {
            const next = values.slice(0, columns);
            for (let i = next.length; i < columns; i++) {
                next[i] = fill(i);
            }
            return next;
        };
        const lastGrowth = scenario.growth.at(-1) ?? '10';
        const lastMargin = scenario.margin.at(-1) ?? '10';
        const lastPeLow = scenario.peLow.at(-1) ?? '15';
        const lastPeHigh = scenario.peHigh.at(-1) ?? '25';
        return {
            name: scenario.name,
            growth: resize(scenario.growth, (i) => (i === 0 ? '' : lastGrowth)),
            margin: resize(scenario.margin, (i) => (i === 0 ? '' : lastMargin)),
            peLow: resize(scenario.peLow, () => lastPeLow),
            peHigh: resize(scenario.peHigh, () => lastPeHigh),
        };
    }

    private nextScenarioName(): string {
        const names = this.scenarioNames();
        for (const preset of ['Base 2', 'Bear', 'Bull', 'Base 3']) {
            if (!names.includes(preset)) {
                return preset;
            }
        }
        return `Scenario ${names.length + 1}`;
    }

    private defaultDrafts(fundamentals: FundamentalsResult | null): ModelDrafts {
        const baseYear =
            fundamentals?.fiscalYearEnd !== null && fundamentals !== undefined && fundamentals !== null
                ? Number(fundamentals.fiscalYearEnd.slice(0, 4))
                : new Date().getUTCFullYear();
        const baseRevenue = fundamentals?.revenueFy ?? fundamentals?.revenueTtm ?? '';
        const baseNetIncome = fundamentals?.netIncomeFy ?? '';
        const growthPct = this.prefillGrowthPct(fundamentals);
        const marginPct = this.prefillMarginPct(fundamentals);
        const peLow = this.prefillPe(fundamentals, FALLBACK_PE_LOW);
        const peHigh = this.prefillPe(fundamentals, FALLBACK_PE_HIGH);
        const columns = DEFAULT_PROJECTED_YEARS + 1;
        return {
            baseYear: Number.isInteger(baseYear) ? String(baseYear) : String(new Date().getUTCFullYear()),
            baseRevenue: baseRevenue === '' ? '' : String(baseRevenue),
            baseNetIncome: baseNetIncome === '' ? '' : String(baseNetIncome),
            currentPrice: '',
            sharesOutstanding: '',
            currency: fundamentals?.currency ?? '',
            projectedYears: String(DEFAULT_PROJECTED_YEARS),
            scenarios: [
                {
                    name: 'Base',
                    growth: Array.from({ length: columns }, (_, i) => (i === 0 ? '' : growthPct)),
                    margin: Array.from({ length: columns }, (_, i) => (i === 0 ? '' : marginPct)),
                    peLow: Array.from({ length: columns }, () => peLow),
                    peHigh: Array.from({ length: columns }, () => peHigh),
                },
            ],
        };
    }

    private prefillGrowthPct(fundamentals: FundamentalsResult | null): string {
        const growth = fundamentals?.revenueGrowthTtm ?? null;
        if (growth === null) {
            return DEFAULT_GROWTH_PCT.toFixed();
        }
        const pct = new Decimal(growth).times(100);
        if (pct.lte(-100) || pct.gt(1000)) {
            return DEFAULT_GROWTH_PCT.toFixed();
        }
        return pct.toFixed(1);
    }

    private prefillMarginPct(fundamentals: FundamentalsResult | null): string {
        const margin = fundamentals?.marginTtm ?? null;
        if (margin === null) {
            return '10';
        }
        const pct = new Decimal(margin).times(100);
        if (pct.lte(-100) || pct.gte(100)) {
            return '10';
        }
        return pct.toFixed(1);
    }

    private prefillPe(fundamentals: FundamentalsResult | null, fallback: Decimal): string {
        const pe = fundamentals?.peTtm ?? null;
        if (pe === null) {
            return fallback.toFixed();
        }
        const value = new Decimal(pe);
        if (value.lte(0) || value.gt(1000)) {
            return fallback.toFixed();
        }
        return value.toFixed(1);
    }

    private parseDecimal(value: string): Decimal | null {
        if (value.trim() === '') {
            return null;
        }
        try {
            const decimal = new Decimal(value.replace(',', '.'));
            return decimal.isFinite() ? decimal : null;
        } catch {
            return null;
        }
    }
}

function draftsFromModel(model: ProjectionModel): ModelDrafts {
    return {
        baseYear: String(model.baseYear),
        baseRevenue: model.baseRevenue.toFixed(),
        baseNetIncome: model.baseNetIncome.toFixed(),
        currentPrice: model.currentPrice?.toFixed() ?? '',
        sharesOutstanding: model.sharesOutstanding?.toFixed() ?? '',
        currency: model.currency ?? '',
        projectedYears: String(model.projectedYears),
        scenarios: model.scenarios.map((scenario) => ({
            name: scenario.name,
            growth: scenario.rows.map((row, i) => (i === 0 ? '' : (row.revenueGrowthPct?.toFixed() ?? ''))),
            margin: scenario.rows.map((row, i) => (i === 0 ? '' : (row.netMarginPct?.toFixed() ?? ''))),
            peLow: scenario.rows.map((row) => row.peLow.toFixed()),
            peHigh: scenario.rows.map((row) => row.peHigh.toFixed()),
        })),
    };
}

function storedModelAssumptionsLabel(stored: StoredProjectionModel): string {
    const scenario = stored.scenarios[0];
    if (scenario === undefined) {
        return '–';
    }
    const growth = scenario.rows[1]?.revenueGrowthPct ?? null;
    const margin = scenario.rows[1]?.netMarginPct ?? null;
    const peLow = scenario.rows.at(-1)?.peLow ?? '–';
    const peHigh = scenario.rows.at(-1)?.peHigh ?? '–';
    const formatPct = (value: string | null): string =>
        value === null ? '–' : `${new Decimal(value).toSignificantDigits(4)}%`;
    return `${formatPct(growth)} · ${formatPct(margin)} · PE ${new Decimal(peLow).toSignificantDigits(4)}–${new Decimal(peHigh).toSignificantDigits(4)}`;
}

function buildProjectionForModel(stored: StoredProjectionSnapshot['model']) {
    const model: ProjectionModel = {
        symbol: stored.symbol,
        baseYear: stored.baseYear,
        baseRevenue: new Decimal(stored.baseRevenue),
        baseNetIncome: new Decimal(stored.baseNetIncome),
        currentPrice: stored.currentPrice === null ? null : new Decimal(stored.currentPrice),
        sharesOutstanding: stored.sharesOutstanding === null ? null : new Decimal(stored.sharesOutstanding),
        currency: stored.currency ?? '',
        projectedYears: stored.projectedYears,
        scenarios: stored.scenarios.map((scenario) => ({
            name: scenario.name,
            rows: scenario.rows.map((row) => ({
                revenueGrowthPct: row.revenueGrowthPct === null ? null : new Decimal(row.revenueGrowthPct),
                netMarginPct: row.netMarginPct === null ? null : new Decimal(row.netMarginPct),
                peLow: new Decimal(row.peLow),
                peHigh: new Decimal(row.peHigh),
            })),
        })),
    };
    const inputs = resolveProjectionInputs(model, { currentPrice: null, sharesOutstanding: null });
    if (inputs === null) {
        return null;
    }
    return buildProjection(inputs[0]);
}
