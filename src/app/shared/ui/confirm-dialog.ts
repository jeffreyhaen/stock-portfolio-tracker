import { Component, input, output } from '@angular/core';

@Component({
    selector: 'app-confirm-dialog',
    template: `
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            [attr.aria-labelledby]="titleId()"
        >
            <div class="w-full max-w-md rounded-xl border border-base-300 bg-base-100 p-6 shadow-md">
                <h2 [id]="titleId()" class="text-base font-semibold">{{ title() }}</h2>
                <p class="mt-2 text-sm text-base-content/80">{{ description() }}</p>
                <ng-content />
                <div class="mt-6 flex justify-end gap-2">
                    <button type="button" class="btn btn-outline btn-sm" (click)="cancelled.emit()">
                        {{ cancelLabel() }}
                    </button>
                    <button
                        type="button"
                        class="btn btn-sm"
                        [class.btn-error]="dangerous()"
                        [class.btn-primary]="!dangerous()"
                        (click)="confirmed.emit()"
                    >
                        {{ confirmLabel() }}
                    </button>
                </div>
            </div>
        </div>
    `,
})
export class ConfirmDialogComponent {
    readonly title = input.required<string>();
    readonly description = input.required<string>();
    readonly confirmLabel = input('Confirm');
    readonly cancelLabel = input('Cancel');
    readonly dangerous = input(false);

    readonly confirmed = output<void>();
    readonly cancelled = output<void>();

    readonly titleId = (): string => 'confirm-dialog-title';
}
