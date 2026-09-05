import { Component, ElementRef, signal, viewChild, input } from '@angular/core';

@Component({
    selector: 'app-nav-dropdown',
    template: `
        <div #root class="relative">
            <button
                type="button"
                class="flex items-center gap-1 rounded-field px-3 py-1.5 text-sm text-text-secondary hover:bg-base-200"
                [class.bg-primary-soft]="open()"
                [class.text-primary]="open()"
                [attr.aria-expanded]="open()"
                aria-haspopup="menu"
                (click)="toggle()"
            >
                <ng-content select="[dropdown-label]" />
                <svg
                    class="h-3.5 w-3.5 transition-transform"
                    [class.rotate-180]="open()"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                    stroke="currentColor"
                >
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
            </button>
            @if (open()) {
                <div
                    class="absolute top-full z-50 mt-1 min-w-48 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm"
                    [class.left-0]="align() === 'left'"
                    [class.right-0]="align() === 'right'"
                    role="menu"
                >
                    <ng-content />
                </div>
            }
        </div>
    `,
    host: {
        '(document:click)': 'onDocumentClick($event)',
        '(document:keydown.escape)': 'close()',
    },
})
export class NavDropdownComponent {
    readonly align = input<'left' | 'right'>('left');

    private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
    readonly open = signal(false);

    toggle(): void {
        this.open.set(!this.open());
    }

    close(): void {
        this.open.set(false);
    }

    onDocumentClick(event: MouseEvent): void {
        if (!this.open()) {
            return;
        }
        const target = event.target as Node;
        const root = this.root().nativeElement;
        if (!root.contains(target)) {
            this.close();
            return;
        }
        const trigger = root.querySelector('button');
        if (trigger !== null && trigger.contains(target)) {
            return;
        }
        this.close();
    }
}
