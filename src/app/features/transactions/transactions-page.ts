import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { mutationInReportingCurrency } from '../../domain/fx';
import { mergeSplitExecutions } from '../../domain/split-execution-merge';
import { Transaction, TransactionType } from '../../domain/types';
import { MoneyPipe } from '../../shared/money.pipe';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { transactionTypeBadgeClass, transactionTypeLabel } from '../../shared/transaction-type';
import { TableSort } from '../../shared/sort';
import { SortThComponent } from '../../shared/ui/sort-th';

type SortKey = 'date' | 'type' | 'description' | 'quantity' | 'amount';

const PAGE_SIZE = 100;

interface TransactionView {
    readonly id: string;
    readonly rowIndex: number;
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
    readonly mutationReporting: Decimal | null;
    readonly mutationReportingCurrency: string | null;
    readonly showOriginalMutation: boolean;
}

@Component({
    selector: 'app-transactions-page',
    imports: [RouterLink, MoneyPipe, LocalizedDatePipe, LocalizedNumberPipe, SortThComponent],
    templateUrl: './transactions-page.html',
})
export class TransactionsPage {
    private readonly context = inject(PortfolioContext);
    private readonly marketData = inject(MarketDataService);

    readonly search = signal('');
    readonly typeFilter = signal('ALL');
    readonly visibleCount = signal(PAGE_SIZE);

    constructor() {
        void this.marketData.reload();
    }

    readonly reportingCurrency = computed(() => this.context.selectedPortfolio()?.reportingCurrency ?? 'EUR');

    readonly sort = new TableSort<SortKey, TransactionView>(
        {
            date: (row) => `${row.date}T${row.time}#${String(row.rowIndex).padStart(8, '0')}`,
            type: (row) => row.label,
            description: (row) => (row.product === '' ? row.description : row.product),
            quantity: (row) => row.quantity,
            amount: (row) => row.mutationReporting ?? row.mutation,
        },
        'date',
        'desc',
    );

    readonly availableTypes = computed(() => {
        const typen = new Set<TransactionType>();
        for (const txn of this.context.transactions()) {
            typen.add(txn.type);
        }
        return [...typen].sort((a, b) => transactionTypeLabel(a).localeCompare(transactionTypeLabel(b)));
    });

    private readonly filtered = computed(() => {
        const search = this.search().trim().toLowerCase();
        const typeFilter = this.typeFilter();
        return mergeSplitExecutions(this.context.transactions()).filter((txn) => {
            if (typeFilter !== 'ALL' && txn.type !== typeFilter) {
                return false;
            }
            if (search === '') {
                return true;
            }
            return (
                txn.product.toLowerCase().includes(search) ||
                txn.description.toLowerCase().includes(search) ||
                (txn.isin ?? '').toLowerCase().includes(search)
            );
        });
    });

    private readonly sorted = computed(() => this.sort.apply(this.toView(this.filtered())));

    readonly totalCount = computed(() => this.filtered().length);

    readonly transactions = computed<TransactionView[]>(() => this.sorted().slice(0, this.visibleCount()));

    readonly hasMore = computed(() => this.totalCount() > this.visibleCount());

    onSearch(value: string): void {
        this.search.set(value);
        this.visibleCount.set(PAGE_SIZE);
    }

    onTypeFilter(value: string): void {
        this.typeFilter.set(value);
        this.visibleCount.set(PAGE_SIZE);
    }

    showMore(): void {
        this.visibleCount.update((count) => count + PAGE_SIZE);
    }

    typeLabel(type: TransactionType): string {
        return transactionTypeLabel(type);
    }

    private toView(transactions: readonly Transaction[]): TransactionView[] {
        const reportingCurrency = this.reportingCurrency();
        const fx = this.marketData.fxResolver();
        return transactions.map((txn) => toView(txn, reportingCurrency, fx));
    }
}

function toView(
    txn: Transaction,
    reportingCurrency: string,
    fx: (currency: string, date: string) => Decimal | null,
): TransactionView {
    const mutationReporting = mutationInReportingCurrency(txn, reportingCurrency, fx);
    const mutationCurrency = txn.mutationCurrency;
    const afwijkend =
        txn.mutation !== null &&
        mutationCurrency !== null &&
        mutationCurrency !== '' &&
        mutationCurrency !== reportingCurrency;
    return {
        id: txn.id,
        rowIndex: txn.rowIndex,
        date: txn.date,
        time: txn.time,
        type: txn.type,
        label: transactionTypeLabel(txn.type),
        badgeClass: transactionTypeBadgeClass(txn.type),
        product: txn.product,
        description: txn.description,
        quantity: txn.quantity,
        mutation: txn.mutation,
        mutationCurrency,
        mutationReporting,
        mutationReportingCurrency: reportingCurrency,
        showOriginalMutation: afwijkend,
    };
}
