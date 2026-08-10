import { Component, input, output } from '@angular/core';

@Component({
    selector: 'app-confirm-dialog',
    template: `
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/40 p-4"
            role="dialog"
            aria-modal="true"
            [attr.aria-labelledby]="titelId()"
        >
            <div class="w-full max-w-md rounded-xl border border-base-300 bg-base-100 p-6 shadow-md">
                <h2 [id]="titelId()" class="text-base font-semibold">{{ titel() }}</h2>
                <p class="mt-2 text-sm text-base-content/80">{{ beschrijving() }}</p>
                <ng-content />
                <div class="mt-6 flex justify-end gap-2">
                    <button type="button" class="btn btn-outline btn-sm" (click)="annuleren.emit()">
                        {{ annuleerLabel() }}
                    </button>
                    <button
                        type="button"
                        class="btn btn-sm"
                        [class.btn-error]="gevaarlijk()"
                        [class.btn-primary]="!gevaarlijk()"
                        (click)="bevestigen.emit()"
                    >
                        {{ bevestigLabel() }}
                    </button>
                </div>
            </div>
        </div>
    `,
})
export class ConfirmDialogComponent {
    readonly titel = input.required<string>();
    readonly beschrijving = input.required<string>();
    readonly bevestigLabel = input('Confirm');
    readonly annuleerLabel = input('Cancel');
    readonly gevaarlijk = input(false);

    readonly bevestigen = output<void>();
    readonly annuleren = output<void>();

    readonly titelId = (): string => 'confirm-dialog-titel';
}
