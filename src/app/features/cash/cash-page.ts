import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { PortfolioContext } from '../../data/portfolio-context';
import { cashAt, externalFlows } from '../../domain/engine';
import { MoneyPipe } from '../../shared/money.pipe';

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
    imports: [RouterLink, MoneyPipe],
    templateUrl: './cash-page.html',
})
export class CashPage {
    private readonly context = inject(PortfolioContext);

    readonly rapportagevaluta = computed(() => this.context.selectedPortfolio()?.rapportagevaluta ?? 'EUR');

    readonly balances = computed<CashRow[]>(() => {
        const saldi = cashAt(this.context.transactions());
        return [...saldi.entries()]
            .filter(([, positie]) => !positie.amount.isZero())
            .map(([currency, positie]) => ({
                currency,
                name: VALUTA_NAMEN[currency] ?? currency,
                balance: positie.amount,
            }))
            .sort((a, b) => b.balance.comparedTo(a.balance));
    });

    readonly flows = computed<FlowRow[]>(() => {
        const flows = externalFlows(this.context.transactions());
        return [...flows.entries()]
            .map(([currency, flow]) => ({
                currency,
                deposits: flow.deposits,
                withdrawals: flow.withdrawals,
            }))
            .sort((a, b) => b.deposits.comparedTo(a.deposits));
    });
}
