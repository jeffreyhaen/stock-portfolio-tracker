import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { BenchmarkService, benchmarkIsin, isBenchmarkIsin } from '../../data/benchmark.service';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { buildBenchmarkSeries } from '../../domain/benchmark';
import {
    annualizedReturnPct,
    buildForecastSeries,
    forecastValidationError,
    ForecastAssumptions,
    ForecastSeries,
} from '../../domain/forecast';
import { buildImportedFxResolver } from '../../domain/fx';
import { PriceBar, buildMarketValueSeries } from '../../domain/market-value';
import { buildValuation } from '../../domain/valuation';
import { Cashflow, cashflowWindowDays, MIN_ANNUALIZED_RETURN_DAYS, portfolioCashflows, xirr } from '../../domain/xirr';
import { MoneyPipe } from '../../shared/money.pipe';
import { themeColor } from '../../shared/theme-colors';
import { ThemeService } from '../../shared/theme.service';
import { InfoTooltipComponent } from '../../shared/ui/info-tooltip';
import { ChartSeries, ValueChartComponent } from '../../shared/ui/value-chart';

const MAX_FORECAST_YEARS = 50;
const DEFAULT_FORECAST_YEARS = 10;

interface StartPoint {
    readonly value: Decimal;
    readonly date: string;
    readonly complete: boolean;
}

interface ParsedInputs {
    readonly assumptions: ForecastAssumptions | null;
    readonly benchmarkAnnualReturnPct: Decimal | null;
    readonly error: string | null;
    readonly incomplete: boolean;
}

interface ForecastCards {
    readonly currentValue: Decimal | null;
    readonly projectedValue: Decimal | null;
    readonly totalContributions: Decimal | null;
    readonly investmentGain: Decimal | null;
    readonly benchmarkValue: Decimal | null;
    readonly benchmarkDelta: Decimal | null;
}

@Component({
    selector: 'app-forecast-page',
    imports: [RouterLink, MoneyPipe, InfoTooltipComponent, ValueChartComponent],
    templateUrl: './forecast-page.html',
})
export class ForecastPage {
    private readonly context = inject(PortfolioContext);
    readonly marketData = inject(MarketDataService);
    readonly benchmark = inject(BenchmarkService);
    private readonly theme = inject(ThemeService);

    readonly portfolioId = this.context.selectedPortfolioId;
    readonly reportingCurrency = this.marketData.reportingCurrency;

    readonly maxYears = MAX_FORECAST_YEARS;
    readonly maxDate = new Date().toISOString().slice(0, 10);
    private readonly today = this.maxDate;

    readonly yearsDraft = signal(String(DEFAULT_FORECAST_YEARS));
    readonly returnDraft = signal('');
    readonly monthlyDraft = signal('0');
    readonly benchReturnDraft = signal('');

    private returnPrefilled = false;
    private benchmarkPrefilled = false;

    constructor() {
        void this.marketData.reload();

        effect(() => {
            void this.context.selectedPortfolioId();
            this.returnPrefilled = false;
            this.benchmarkPrefilled = false;
            this.yearsDraft.set(String(DEFAULT_FORECAST_YEARS));
            this.returnDraft.set('');
            this.monthlyDraft.set('0');
            this.benchReturnDraft.set('');
        });

        effect(() => {
            if (!this.returnPrefilled && this.returnDraft() === '') {
                const xirrPct = this.portfolioXirrPct();
                if (xirrPct !== null) {
                    this.returnDraft.set(xirrPct.toFixed(2));
                    this.returnPrefilled = true;
                }
            }
            if (!this.benchmarkPrefilled && this.benchReturnDraft() === '' && this.benchmark.symbol() !== null) {
                const cagr = this.benchmarkCagrPct();
                if (cagr !== null) {
                    this.benchReturnDraft.set(cagr.toFixed(2));
                    this.benchmarkPrefilled = true;
                }
            }
        });
    }

    readonly isEmpty = computed(() => this.context.transactions().length === 0);

    readonly valuation = computed(() =>
        buildValuation(
            this.context.transactions(),
            this.marketData.quoteMap(),
            this.marketData.fxResolver(),
            this.today,
            this.reportingCurrency(),
        ),
    );

    private readonly portfolioIsins = computed(() => {
        const isins = new Set<string>();
        for (const transaction of this.context.transactions()) {
            if (transaction.isin !== null && !isBenchmarkIsin(transaction.isin)) {
                isins.add(transaction.isin);
            }
        }
        return isins;
    });

    private readonly barsMap = computed<ReadonlyMap<string, PriceBar[]>>(() => {
        const portfolioIsins = this.portfolioIsins();
        const map = new Map<string, PriceBar[]>();
        for (const bar of this.marketData.priceHistory()) {
            if (!portfolioIsins.has(bar.isin)) continue;
            const list = map.get(bar.isin) ?? [];
            list.push({ date: bar.date, close: new Decimal(bar.close), currency: bar.currency });
            map.set(bar.isin, list);
        }
        for (const [isin, quote] of this.marketData.quoteMap()) {
            if (!portfolioIsins.has(isin) || quote.date === undefined) continue;
            const list = map.get(isin) ?? [];
            const current = { date: quote.date, close: quote.price, currency: quote.currency };
            const sameDay = list.findIndex((bar) => bar.date === quote.date);
            if (sameDay === -1) list.push(current);
            else list[sameDay] = current;
            map.set(isin, list);
        }
        for (const list of map.values()) {
            list.sort((a, b) => a.date.localeCompare(b.date));
        }
        return map;
    });

    readonly hasHistory = computed(() => {
        const portfolioIsins = this.portfolioIsins();
        return this.marketData.priceHistory().some((bar) => portfolioIsins.has(bar.isin));
    });

    private readonly splitsMap = computed(() => {
        const map = new Map<string, { date: string; factor: Decimal }[]>();
        for (const split of this.marketData.splitEvents()) {
            const list = map.get(split.isin) ?? [];
            list.push({ date: split.date, factor: new Decimal(split.factor) });
            map.set(split.isin, list);
        }
        return map;
    });

    readonly marketSeries = computed(() =>
        buildMarketValueSeries(
            this.context.transactions(),
            this.barsMap(),
            this.marketData.fxResolver(),
            this.splitsMap(),
            this.reportingCurrency(),
        ),
    );

    private readonly rawPoints = computed(() =>
        this.hasHistory() ? this.marketSeries().points : this.valuation().points,
    );

    readonly startPoint = computed<StartPoint | null>(() => {
        const points = this.rawPoints().filter((p) => p.value !== null && p.complete);
        if (points.length > 0) {
            const last = points[points.length - 1];
            return { value: last.value!, date: last.date, complete: true };
        }
        const totals = this.valuation().totals;
        return totals.value === null ? null : { value: totals.value, date: this.today, complete: totals.complete };
    });

    readonly valuationIncomplete = computed(() => this.startPoint()?.complete === false);

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

    readonly forecastInputs = computed<ParsedInputs>(() => {
        const start = this.startPoint();
        const years = Number(this.yearsDraft());
        const annualReturnPct = this.parseDecimal(this.returnDraft());
        const monthlyContribution = this.parseDecimal(this.monthlyDraft());
        const benchmarkAnnualReturnPct = this.parseDecimal(this.benchReturnDraft());
        if (start === null) {
            return {
                assumptions: null,
                benchmarkAnnualReturnPct: null,
                error: 'Add prices or link tickers on the Prices page to project a value.',
                incomplete: false,
            };
        }
        if (this.yearsDraft().trim() === '' || annualReturnPct === null || monthlyContribution === null) {
            return { assumptions: null, benchmarkAnnualReturnPct, error: null, incomplete: true };
        }
        const assumptions: ForecastAssumptions = {
            principal: start.value,
            annualReturnPct,
            monthlyContribution,
            years,
        };
        return {
            assumptions,
            benchmarkAnnualReturnPct,
            error: forecastValidationError(assumptions),
            incomplete: false,
        };
    });

    readonly portfolioForecast = computed<ForecastSeries | null>(() => {
        const inputs = this.forecastInputs();
        const start = this.startPoint();
        if (inputs.error !== null || inputs.assumptions === null || start === null) {
            return null;
        }
        return buildForecastSeries(inputs.assumptions, this.today);
    });

    readonly benchmarkForecast = computed<ForecastSeries | null>(() => {
        const inputs = this.forecastInputs();
        const start = this.startPoint();
        if (
            inputs.error !== null ||
            inputs.assumptions === null ||
            inputs.benchmarkAnnualReturnPct === null ||
            this.benchmark.symbol() === null ||
            start === null
        ) {
            return null;
        }
        return buildForecastSeries(
            { ...inputs.assumptions, annualReturnPct: inputs.benchmarkAnnualReturnPct },
            this.today,
        );
    });

    readonly forecastDelta = computed<Decimal | null>(() => {
        const portfolio = this.portfolioForecast();
        const benchmark = this.benchmarkForecast();
        return portfolio === null || benchmark === null ? null : portfolio.endValue.minus(benchmark.endValue);
    });

    readonly chartSeries = computed<ChartSeries[]>(() => {
        this.theme.theme();
        const portfolio = this.portfolioForecast();
        const benchmark = this.benchmarkForecast();
        if (portfolio === null) {
            return [];
        }
        const series: ChartSeries[] = [
            {
                name: 'Portfolio forecast',
                color: themeColor('--color-chart-line', '#0068f0'),
                dashed: false,
                fill: true,
                points: portfolio.points.map((p) => ({ time: p.date, value: p.value.toNumber() })),
            },
        ];
        const symbol = this.benchmark.symbol();
        if (benchmark !== null && symbol !== null) {
            series.push({
                name: `${symbol} forecast`,
                color: themeColor('--color-chart-compare', '#d97706'),
                dashed: true,
                fill: false,
                points: benchmark.points.map((p) => ({ time: p.date, value: p.value.toNumber() })),
            });
        }
        return series;
    });

    readonly cards = computed<ForecastCards>(() => {
        const portfolio = this.portfolioForecast();
        const benchmark = this.benchmarkForecast();
        const start = this.startPoint();
        return {
            currentValue: start?.value ?? null,
            projectedValue: portfolio?.endValue ?? null,
            totalContributions: portfolio?.totalContributions ?? null,
            investmentGain: portfolio?.investmentGain ?? null,
            benchmarkValue: benchmark?.endValue ?? null,
            benchmarkDelta: this.forecastDelta(),
        };
    });

    readonly portfolioXirrPct = computed<Decimal | null>(() => {
        const points = this.rawPoints();
        if (points.length === 0) {
            return null;
        }
        const first = points[0];
        const last = points[points.length - 1];
        if (!last.complete || last.value === null) {
            return null;
        }
        const windowDays = cashflowWindowDays([
            { date: first.date, amount: new Decimal(0) },
            { date: last.date, amount: new Decimal(0) },
        ]);
        if (windowDays < MIN_ANNUALIZED_RETURN_DAYS) {
            return null;
        }
        const reportingCurrency = this.reportingCurrency();
        const txns = this.context.transactions();
        const importedFx = buildImportedFxResolver(txns, reportingCurrency);
        const marketFx = this.marketData.fxResolver();
        const external = portfolioCashflows(txns, {
            reportingCurrency,
            fxFallback: (currency, date) => importedFx(currency, date) ?? marketFx(currency, date),
        });
        if (external === null || last.value === null) {
            return null;
        }
        const flows: Cashflow[] = [...external, { date: last.date, amount: last.value }];
        const result = xirr(flows);
        return result === null ? null : result.times(100);
    });

    private readonly benchmarkBars = computed<PriceBar[]>(() => {
        const symbol = this.benchmark.symbol();
        if (symbol === null) {
            return [];
        }
        const key = benchmarkIsin(symbol);
        return this.marketData
            .priceHistory()
            .filter((bar) => bar.isin === key)
            .map((bar) => ({ date: bar.date, close: new Decimal(bar.close), currency: bar.currency }));
    });

    readonly benchmarkCagrPct = computed<Decimal | null>(() => {
        const bars = this.benchmarkBars();
        if (bars.length < 2 || this.rawPoints().length < 2) {
            return null;
        }
        const dates = this.rawPoints().map((p) => p.date);
        const series = buildBenchmarkSeries(bars, dates, this.marketData.fxResolver(), this.reportingCurrency());
        if (series.points.length < 2) {
            return null;
        }
        const first = series.points[0];
        const last = series.points[series.points.length - 1];
        return annualizedReturnPct(first.close, last.close, daysBetween(first.date, last.date));
    });

    readonly returnTooltip = computed(() => {
        const xirrPct = this.portfolioXirrPct();
        const base = 'Expected annual return used for compounding.';
        return xirrPct === null
            ? `${base} Your history is too short or incomplete for a prefill, so enter your own assumption.`
            : `${base} Prefilled with your all-time money-weighted return (XIRR): ${formatPct(xirrPct)}% per year. Past performance is no guarantee for the future — adjust freely.`;
    });

    readonly benchmarkReturnTooltip = computed(() => {
        const cagr = this.benchmarkCagrPct();
        const base = 'Expected annual return for the benchmark scenario, with the same monthly contribution.';
        return cagr === null
            ? `${base} Enter an assumption yourself; benchmark history is too short or unavailable for a prefill.`
            : `${base} Prefilled with the annualized price return of ${this.benchmark.symbol()} over the available history. Price return only: dividends are not included.`;
    });

    readonly contributionTooltip = computed(
        () =>
            'Additional amount invested at the end of every month, in your reporting currency. Forecast contributions never change your real transactions.',
    );

    readonly horizonTooltip = computed(() => 'Number of years to project, compounded monthly.');

    readonly disclaimer = computed(() => {
        const start = this.startPoint();
        const startNote = start === null ? '' : ` Starts from your portfolio value of ${formatLongDate(start.date)}.`;
        return `Nominal values in your reporting currency.${startNote} A scenario, not investment advice: past performance is no guarantee for future results.`;
    });
}

function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function formatLongDate(date: string): string {
    return new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
}

function formatPct(value: Decimal): string {
    return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        value.toNumber(),
    );
}
