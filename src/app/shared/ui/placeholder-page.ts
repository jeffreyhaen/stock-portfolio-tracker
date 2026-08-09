import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
    selector: 'app-placeholder-page',
    template: `
        <h1 class="text-3xl font-bold">{{ title() }}</h1>
        <p class="mt-2 text-sm text-base-content/60">Available from milestone {{ milestone() }}.</p>
    `,
})
export class PlaceholderPage {
    private readonly route = inject(ActivatedRoute);
    readonly title = signal<string>((this.route.snapshot.data['title'] as string) ?? '');
    readonly milestone = signal<string>((this.route.snapshot.data['milestone'] as string) ?? '');
}
