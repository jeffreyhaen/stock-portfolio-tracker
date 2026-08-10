import { Component, computed, input } from '@angular/core';
import { SortController } from '../sort';

@Component({
    selector: 'app-sort-th',
    template: `
        <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 uppercase tracking-wide hover:text-base-content"
            (click)="sort().toggle(sortKey())"
        >
            <ng-content />
            <span class="text-[0.625rem]" [class.opacity-40]="!active()" aria-hidden="true">{{ arrow() }}</span>
        </button>
    `,
})
export class SortThComponent {
    readonly sort = input.required<SortController>();
    readonly sortKey = input.required<string>();

    readonly active = computed(() => this.sort().state().key === this.sortKey());
    readonly arrow = computed(() => {
        if (!this.active()) {
            return '↕';
        }
        return this.sort().state().direction === 'asc' ? '↑' : '↓';
    });
}
