import { AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, input, viewChild } from '@angular/core';
import {
    AreaSeries,
    ColorType,
    IChartApi,
    ISeriesApi,
    LineSeries,
    LineStyle,
    LineData,
    createChart,
} from 'lightweight-charts';
import { ThemeService } from '../theme.service';
import { themeColor, withAlpha } from '../theme-colors';

export interface ChartPoint {
    readonly time: string;
    readonly value: number;
}

export interface ChartSeries {
    readonly name: string;
    readonly color: string;
    readonly dashed: boolean;
    readonly fill: boolean;
    readonly points: ChartPoint[];
}

const eurFormatter = (value: number): string =>
    new Intl.NumberFormat('nl-NL', { notation: 'compact', maximumFractionDigits: 0 }).format(value);

/** Values are index points (100 = range start); labels show the signed return %. */
const pctFormatter = (value: number): string =>
    `${new Intl.NumberFormat('nl-NL', { signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(value - 100)}%`;

@Component({
    selector: 'app-value-chart',
    template: '<div #host class="h-80 w-full"></div>',
})
export class ValueChartComponent implements AfterViewInit, OnDestroy {
    readonly series = input.required<ChartSeries[]>();
    /** Render the chart in indexed performance mode: % labels, all series indexed to 100 at range start. */
    readonly pct = input(false);

    private readonly themeService = inject(ThemeService);
    private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
    private chart: IChartApi | null = null;
    private rendered: ISeriesApi<'Area' | 'Line'>[] = [];
    private resizeObserver: ResizeObserver | null = null;

    constructor() {
        effect(() => {
            this.series();
            this.render();
        });
        effect(() => {
            this.pct();
            this.applyPriceFormatter();
            this.render();
        });
        effect(() => {
            this.themeService.theme();
            this.applyTheme();
        });
    }

    private applyPriceFormatter(): void {
        this.chart?.applyOptions({
            localization: {
                locale: 'nl-NL',
                priceFormatter: this.pct() ? pctFormatter : eurFormatter,
            },
        });
    }

    private applyTheme(): void {
        if (this.chart === null) {
            return;
        }
        this.chart.applyOptions({
            layout: { textColor: themeColor('--color-chart-text', '#5b6472') },
            grid: { horzLines: { color: themeColor('--color-chart-grid', '#eef1f5') } },
        });
        this.render();
    }

    ngAfterViewInit(): void {
        const element = this.host()?.nativeElement;
        if (element === undefined || typeof window.matchMedia !== 'function') {
            return;
        }
        try {
            this.chart = createChart(element, {
                layout: {
                    background: { type: ColorType.Solid, color: 'transparent' },
                    textColor: themeColor('--color-chart-text', '#5b6472'),
                    fontSize: 11,
                    attributionLogo: false,
                },
                grid: {
                    vertLines: { visible: false },
                    horzLines: { color: themeColor('--color-chart-grid', '#eef1f5') },
                },
                rightPriceScale: { borderVisible: false },
                timeScale: { borderVisible: false },
                localization: {
                    locale: 'nl-NL',
                    priceFormatter: this.pct() ? pctFormatter : eurFormatter,
                },
                autoSize: false,
                width: element.clientWidth,
                height: element.clientHeight,
            });
        } catch {
            this.chart = null;
            return;
        }
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.chart?.resize(element.clientWidth, element.clientHeight);
            });
            this.resizeObserver.observe(element);
        }
        this.render();
    }

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        this.chart?.remove();
        this.chart = null;
    }

    private render(): void {
        if (this.chart === null) {
            return;
        }
        for (const series of this.rendered) {
            this.chart.removeSeries(series);
        }
        this.rendered = [];
        for (const series of this.series()) {
            const data: LineData[] = series.points.map((p) => ({ time: p.time, value: p.value }));
            if (series.fill) {
                const fill = themeColor('--color-chart-fill', '#c0d8f8');
                this.rendered.push(
                    this.chart.addSeries(AreaSeries, {
                        lineColor: series.color,
                        lineWidth: 2,
                        topColor: withAlpha(fill, 0.4),
                        bottomColor: withAlpha(fill, 0),
                        priceLineVisible: false,
                        crosshairMarkerRadius: 4,
                    }),
                );
            } else {
                this.rendered.push(
                    this.chart.addSeries(LineSeries, {
                        color: series.color,
                        lineWidth: 2,
                        lineStyle: series.dashed ? LineStyle.Dashed : LineStyle.Solid,
                        priceLineVisible: false,
                        crosshairMarkerRadius: 4,
                    }),
                );
            }
            this.rendered[this.rendered.length - 1].setData(data);
        }
        this.chart.timeScale().fitContent();
    }
}
