import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { cashAt, externalFlows } from '../../domain/engine';
import { MoneyPipe } from '../../shared/money.pipe';
import { TableSort } from '../../shared/sort';
import { SortThComponent } from '../../shared/ui/sort-th';

const CURRENCY_NAMES: Record<string, string> = {
    EUR: 'Euro',
    USD: 'US Dollar',
    GBP: 'British Pound',
    CHF: 'Swiss Franc',
};

interface CashRow {
    readonly currency: string;
    readonly name: string;
    readonly balance: Decimal;
    readonly balanceReporting: Decimal | null;
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
    private readonly marketData = inject(MarketDataService);

    readonly reportingCurrency = computed(() => this.context.selectedPortfolio()?.reportingCurrency ?? 'EUR');

    constructor() {
        void this.marketData.reload();
    }

    readonly balancesSort = new TableSort<'currency' | 'balance' | 'balanceReporting', CashRow>(
        {
            currency: (row) => row.name,
            balance: (row) => row.balance,
            balanceReporting: (row) => row.balanceReporting,
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

    private readonly unsortedBalances = computed<CashRow[]>(() => {
        const balances = cashAt(this.context.transactions());
        const fx = this.marketData.fxResolver();
        const reporting = this.reportingCurrency();
        return [...balances.entries()]
            .filter(([, position]) => !position.amount.isZero())
            .map(([currency, position]) => {
                const rate = currency === reporting ? new Decimal(1) : fx(currency, position.asOfDate);
                return {
                    currency,
                    name: CURRENCY_NAMES[currency] ?? currency,
                    balance: position.amount,
                    balanceReporting: rate === null ? null : position.amount.times(rate),
                };
            });
    });

    readonly balances = computed(() => this.balancesSort.apply(this.unsortedBalances()));

    private readonly unsortedFlows = computed<FlowRow[]>(() => {
        const flows = externalFlows(this.context.transactions());
        return [...flows.entries()].map(([currency, flow]) => ({
            currency,
            deposits: flow.deposits,
            withdrawals: flow.withdrawals,
        }));
    });

    readonly flows = computed(() => this.flowsSort.apply(this.unsortedFlows()));
}
