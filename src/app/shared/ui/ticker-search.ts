import { Component, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import { TickerSuggestion } from '../../data/market-data-provider';
import { MarketDataSyncService } from '../../data/market-data-sync.service';

const SEARCH_DEBOUNCE_MS = 400;

@Component({
    selector: 'app-ticker-search',
    template: `
        <div>
            <div class="flex items-center gap-2">
                <input
                    type="text"
                    class="input input-sm input-bordered w-36 font-mono"
                    [placeholder]="placeholder()"
                    [value]="query()"
                    (input)="onInput($any($event.target).value)"
                    (keydown.enter)="onEnter()"
                />
                <button type="button" class="btn btn-ghost btn-xs" [disabled]="searching()" (click)="find()">
                    Find
                </button>
                @if (cancelLabel() !== null) {
                    <button type="button" class="btn btn-ghost btn-xs" (click)="cancelled.emit()">
                        {{ cancelLabel() }}
                    </button>
                }
            </div>
            @if (error() !== null) {
                <p class="mt-1 text-[0.8125rem] text-error">{{ error() }}</p>
            }
            @if (suggestions().length > 0) {
                <ul class="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                    @for (sug of suggestions(); track sug.symbol + sug.exchange) {
                        <li>
                            <button
                                type="button"
                                class="text-left text-[0.8125rem] text-primary hover:underline"
                                [disabled]="busy()"
                                (click)="pick.emit(sug)"
                            >
                                <span class="font-mono font-medium">{{ sug.symbol }}</span>
                                <span class="text-base-content/60"> — {{ sug.name }} ({{ sug.exchange }})</span>
                            </button>
                        </li>
                    }
                </ul>
            }
            @if (error() !== null && allowManual() && query().trim() !== '') {
                <button type="button" class="btn btn-ghost btn-xs mt-1 text-primary" (click)="pickManual()">
                    Use '{{ query().trim().toUpperCase() }}' directly
                </button>
            }
        </div>
    `,
})
export class TickerSearchComponent implements OnInit, OnDestroy {
    private readonly marketDataSync = inject(MarketDataSyncService);

    readonly placeholder = input('search…');
    readonly initialQuery = input('');
    readonly fallbackQuery = input('');
    readonly busy = input(false);
    readonly cancelLabel = input<string | null>(null);
    /** Offer the typed text as a raw symbol when the search itself fails (e.g. proxy offline). */
    readonly allowManual = input(false);
    readonly pick = output<TickerSuggestion>();
    readonly cancelled = output<void>();

    readonly query = signal('');
    readonly suggestions = signal<readonly TickerSuggestion[]>([]);
    readonly searching = signal(false);
    readonly error = signal<string | null>(null);

    private timer: ReturnType<typeof setTimeout> | null = null;
    private requestId = 0;

    ngOnInit(): void {
        this.query.set(this.initialQuery());
    }

    onInput(value: string): void {
        this.cancelTimer();
        this.requestId++;
        this.query.set(value);
        this.suggestions.set([]);
        this.error.set(null);
        if (value.trim() === '') {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.find();
        }, SEARCH_DEBOUNCE_MS);
    }

    onEnter(): void {
        this.cancelTimer();
        void this.find();
    }

    pickManual(): void {
        const symbol = this.query().trim().toUpperCase();
        if (symbol === '') {
            return;
        }
        this.pick.emit({ symbol, name: symbol, exchange: '' });
    }

    async find(): Promise<void> {
        this.cancelTimer();
        const query = this.query().trim() === '' ? this.fallbackQuery().trim() : this.query().trim();
        if (query === '') {
            return;
        }
        const requestId = ++this.requestId;
        this.query.set(query);
        this.searching.set(true);
        this.error.set(null);
        try {
            const suggestions = await this.marketDataSync.searchTicker(query);
            if (this.requestId !== requestId) {
                return;
            }
            this.suggestions.set(suggestions);
            if (suggestions.length === 0) {
                this.error.set('No tickers found.');
            }
        } catch (error) {
            if (this.requestId !== requestId) {
                return;
            }
            this.suggestions.set([]);
            this.error.set(String((error as Error).message ?? error));
        } finally {
            if (this.requestId === requestId) {
                this.searching.set(false);
            }
        }
    }

    ngOnDestroy(): void {
        this.cancelTimer();
    }

    private cancelTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
