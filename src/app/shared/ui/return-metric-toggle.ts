import { Component, inject } from '@angular/core';
import { ReturnMetric, ReturnMetricService } from '../return-metric.service';

@Component({
    selector: 'app-return-metric-toggle',
    template: `
        <div class="inline-flex rounded-full border border-base-300 bg-base-200 p-0.5">
            <button
                type="button"
                class="rounded-full px-3 py-0.5 text-xs font-medium transition-colors"
                [class.bg-primary]="metric() === 'simple'"
                [class.text-primary-content]="metric() === 'simple'"
                [class.text-base-content/60]="metric() !== 'simple'"
                (click)="select('simple')"
            >
                Cumulative
            </button>
            <button
                type="button"
                class="rounded-full px-3 py-0.5 text-xs font-medium transition-colors"
                [class.bg-primary]="metric() === 'money-weighted'"
                [class.text-primary-content]="metric() === 'money-weighted'"
                [class.text-base-content/60]="metric() !== 'money-weighted'"
                (click)="select('money-weighted')"
            >
                Money-weighted
            </button>
        </div>
    `,
})
export class ReturnMetricToggleComponent {
    private readonly service = inject(ReturnMetricService);

    readonly metric = this.service.metric;

    select(metric: ReturnMetric): void {
        this.service.set(metric);
    }
}
