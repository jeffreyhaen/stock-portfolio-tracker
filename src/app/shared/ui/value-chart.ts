import { AfterViewInit, Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
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

@Component({
    selector: 'app-value-chart',
    template: '<div #host class="h-80 w-full"></div>',
})
export class ValueChartComponent implements AfterViewInit, OnDestroy {
    readonly series = input.required<ChartSeries[]>();

    private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
    private chart: IChartApi | null = null;
    private rendered: ISeriesApi<'Area' | 'Line'>[] = [];
    private resizeObserver: ResizeObserver | null = null;

    constructor() {
        effect(() => {
            this.series();
            this.render();
        });
    }

    ngAfterViewInit(): void {
        const element = this.host()?.nativeElement;
        if (element === undefined) {
            return;
        }
        try {
            this.chart = createChart(element, {
                layout: {
                    background: { type: ColorType.Solid, color: 'transparent' },
                    textColor: '#5b6472',
                    fontSize: 11,
                    attributionLogo: false,
                },
                grid: {
                    vertLines: { visible: false },
                    horzLines: { color: '#eef1f5' },
                },
                rightPriceScale: { borderVisible: false },
                timeScale: { borderVisible: false },
                localization: {
                    locale: 'nl-NL',
                    priceFormatter: (waarde: number): string =>
                        new Intl.NumberFormat('nl-NL', { notation: 'compact', maximumFractionDigits: 0 }).format(
                            waarde,
                        ),
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
        for (const serie of this.rendered) {
            this.chart.removeSeries(serie);
        }
        this.rendered = [];
        for (const serie of this.series()) {
            const data: LineData[] = serie.points.map((p) => ({ time: p.time, value: p.value }));
            if (serie.fill) {
                this.rendered.push(
                    this.chart.addSeries(AreaSeries, {
                        lineColor: serie.color,
                        lineWidth: 2,
                        topColor: 'rgba(192, 216, 248, 0.4)',
                        bottomColor: 'rgba(192, 216, 248, 0)',
                        priceLineVisible: false,
                        crosshairMarkerRadius: 4,
                    }),
                );
            } else {
                this.rendered.push(
                    this.chart.addSeries(LineSeries, {
                        color: serie.color,
                        lineWidth: 2,
                        lineStyle: serie.dashed ? LineStyle.Dashed : LineStyle.Solid,
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
