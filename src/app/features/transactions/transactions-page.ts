import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { PortfolioContext } from '../../data/portfolio-context';
import { Transaction, TransactionType } from '../../domain/types';
import { MoneyPipe } from '../../shared/money.pipe';
import { NlDatePipe } from '../../shared/nl-date.pipe';
import { NlNumberPipe } from '../../shared/nl-number.pipe';
import { transactionTypeBadgeClass, transactionTypeLabel } from '../../shared/transaction-type';
import { TableSort } from '../../shared/sort';
import { SortThComponent } from '../../shared/ui/sort-th';

type SortKey = 'date' | 'type' | 'description' | 'quantity' | 'amount';

interface TransactionView {
    readonly id: string;
    readonly date: string;
    readonly time: string;
    readonly type: TransactionType;
    readonly label: string;
    readonly badgeClass: string;
    readonly product: string;
    readonly description: string;
    readonly quantity: Decimal | null;
    readonly mutation: Decimal | null;
    readonly mutationCurrency: string | null;
}

const PAGINA_GROOTTE = 100;

@Component({
    selector: 'app-transactions-page',
    imports: [RouterLink, MoneyPipe, NlDatePipe, NlNumberPipe, SortThComponent],
    templateUrl: './transactions-page.html',
})
export class TransactionsPage {
    private readonly context = inject(PortfolioContext);

    readonly search = signal('');
    readonly typeFilter = signal('ALL');
    readonly zichtbareAantallen = signal(PAGINA_GROOTTE);

    readonly sort = new TableSort<SortKey, Transaction>(
        {
            date: (txn) => `${txn.date}T${txn.time}#${String(txn.rowIndex).padStart(8, '0')}`,
            type: (txn) => transactionTypeLabel(txn.type),
            description: (txn) => (txn.product === '' ? txn.description : txn.product),
            quantity: (txn) => txn.quantity,
            amount: (txn) => txn.mutation,
        },
        'date',
        'desc',
    );

    readonly beschikbareTypen = computed(() => {
        const typen = new Set<TransactionType>();
        for (const txn of this.context.transactions()) {
            typen.add(txn.type);
        }
        return [...typen].sort((a, b) => transactionTypeLabel(a).localeCompare(transactionTypeLabel(b)));
    });

    private readonly gefilterd = computed(() => {
        const zoek = this.search().trim().toLowerCase();
        const typeFilter = this.typeFilter();
        return this.context.transactions().filter((txn) => {
            if (typeFilter !== 'ALL' && txn.type !== typeFilter) {
                return false;
            }
            if (zoek === '') {
                return true;
            }
            return (
                txn.product.toLowerCase().includes(zoek) ||
                txn.description.toLowerCase().includes(zoek) ||
                (txn.isin ?? '').toLowerCase().includes(zoek)
            );
        });
    });

    private readonly gesorteerd = computed(() => this.sort.apply(this.gefilterd()));

    readonly totaalAantal = computed(() => this.gefilterd().length);

    readonly transactions = computed<TransactionView[]>(() =>
        this.gesorteerd()
            .slice(0, this.zichtbareAantallen())
            .map((txn) => toView(txn)),
    );

    readonly heeftMeer = computed(() => this.totaalAantal() > this.zichtbareAantallen());

    onSearch(value: string): void {
        this.search.set(value);
        this.zichtbareAantallen.set(PAGINA_GROOTTE);
    }

    onTypeFilter(value: string): void {
        this.typeFilter.set(value);
        this.zichtbareAantallen.set(PAGINA_GROOTTE);
    }

    toonMeer(): void {
        this.zichtbareAantallen.update((n) => n + PAGINA_GROOTTE);
    }

    typeLabel(type: TransactionType): string {
        return transactionTypeLabel(type);
    }
}

function toView(txn: Transaction): TransactionView {
    return {
        id: txn.id,
        date: txn.date,
        time: txn.time,
        type: txn.type,
        label: transactionTypeLabel(txn.type),
        badgeClass: transactionTypeBadgeClass(txn.type),
        product: txn.product,
        description: txn.description,
        quantity: txn.quantity,
        mutation: txn.mutation,
        mutationCurrency: txn.mutationCurrency,
    };
}
