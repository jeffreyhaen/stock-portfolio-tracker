import { Component, input } from '@angular/core';

@Component({
    selector: 'app-info-tooltip',
    template: `
        <span
            tabindex="0"
            class="tooltip tooltip-bottom cursor-help"
            [class.tooltip-end]="placement() === 'bottom-end'"
            [class.text-base-content/60]="tone() === 'info'"
            [class.text-warning]="tone() === 'warning'"
            role="img"
            [attr.aria-label]="tone() === 'warning' ? 'Warning' : 'More info'"
            [attr.data-tip]="text()"
        >
            @if (tone() === 'warning') {
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
                <path
                    fill-rule="evenodd"
                    d="M9.401 3.003c.812-1.407 2.843-1.407 3.655 0l7.024 12.176c.812 1.407-.203 3.166-1.827 3.166H4.204c-1.624 0-2.639-1.759-1.827-3.166L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 6a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"
                    clip-rule="evenodd"
                />
            </svg>
            } @else {
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
                <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM10 8a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1Zm0-3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
                    clip-rule="evenodd"
                />
            </svg>
            }
        </span>
    `,
})
export class InfoTooltipComponent {
    readonly text = input.required<string>();
    readonly tone = input<'info' | 'warning'>('info');
    readonly placement = input<'bottom' | 'bottom-end'>('bottom');
}
