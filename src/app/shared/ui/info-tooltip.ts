import { Component, input } from '@angular/core';

@Component({
    selector: 'app-info-tooltip',
    template: `
        <span
            tabindex="0"
            class="tooltip tooltip-bottom cursor-help text-base-content/60"
            role="img"
            aria-label="More info"
            [attr.data-tip]="text()"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
                <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM10 8a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1Zm0-3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
                    clip-rule="evenodd"
                />
            </svg>
        </span>
    `,
})
export class InfoTooltipComponent {
    readonly text = input.required<string>();
}
