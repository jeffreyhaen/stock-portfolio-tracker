import { Component, inject } from '@angular/core';
import { ReturnMetric, ReturnMetricService } from '../return-metric.service';

@Component({
    selector: 'app-return-metric-toggle',
    template: `
        <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-base-content/60">Return</span>
            <button
                type="button"
                class="btn btn-sm"
                [class.btn-primary]="metric() === 'simple'"
                [class.btn-ghost]="metric() !== 'simple'"
                (click)="select('simple')"
            >
                Simple
            </button>
            <button
                type="button"
                class="btn btn-sm"
                [class.btn-primary]="metric() === 'money-weighted'"
                [class.btn-ghost]="metric() !== 'money-weighted'"
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
