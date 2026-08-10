import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { PortfolioContext } from '../../data/portfolio-context';
import { cashAt, externalFlows } from '../../domain/engine';
import { MoneyPipe } from '../../shared/money.pipe';
import { TableSort } from '../../shared/sort';
import { SortThComponent } from '../../shared/ui/sort-th';

const VALUTA_NAMEN: Record<string, string> = {
    EUR: 'Euro',
    USD: 'US Dollar',
    GBP: 'British Pound',
    CHF: 'Swiss Franc',
};

interface CashRow {
    readonly currency: string;
    readonly name: string;
    readonly balance: Decimal;
}

interface FlowRow {
    readonly currency: string;
    readonly deposits: Decimal;
    readonly withdrawals: Decimal;
}

@Component({
    selector: 'app-cash-page',
    imports: [RouterLink, MoneyPipe, SortThComponent],
    templateUrl: './cash-page.html',
})
export class CashPage {
    private readonly context = inject(PortfolioContext);

    readonly rapportagevaluta = computed(() => this.context.selectedPortfolio()?.rapportagevaluta ?? 'EUR');

    readonly balancesSort = new TableSort<'currency' | 'balance' | 'balanceReporting', CashRow>(
        {
            currency: (row) => row.name,
            balance: (row) => row.balance,
            balanceReporting: (row) => (row.currency === this.rapportagevaluta() ? row.balance : null),
        },
        'balance',
        'desc',
    );

    readonly flowsSort = new TableSort<'currency' | 'deposits' | 'withdrawals' | 'net', FlowRow>(
        {
            currency: (row) => row.currency,
            deposits: (row) => row.deposits,
            withdrawals: (row) => row.withdrawals,
            net: (row) => row.deposits.plus(row.withdrawals),
        },
        'deposits',
        'desc',
    );

    private readonly ongesorteerdeBalances = computed<CashRow[]>(() => {
        const saldi = cashAt(this.context.transactions());
        return [...saldi.entries()]
            .filter(([, positie]) => !positie.amount.isZero())
            .map(([currency, positie]) => ({
                currency,
                name: VALUTA_NAMEN[currency] ?? currency,
                balance: positie.amount,
            }));
    });

    readonly balances = computed(() => this.balancesSort.apply(this.ongesorteerdeBalances()));

    private readonly ongesorteerdeFlows = computed<FlowRow[]>(() => {
        const flows = externalFlows(this.context.transactions());
        return [...flows.entries()].map(([currency, flow]) => ({
            currency,
            deposits: flow.deposits,
            withdrawals: flow.withdrawals,
        }));
    });

    readonly flows = computed(() => this.flowsSort.apply(this.ongesorteerdeFlows()));
}
