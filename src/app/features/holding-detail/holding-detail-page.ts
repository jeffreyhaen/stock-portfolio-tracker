import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { map } from 'rxjs';
import { MarketDataService } from '../../data/market-data.service';
import { PortfolioContext } from '../../data/portfolio-context';
import { buildImportedFxResolver, convertToReportingCurrency, mutationInReportingCurrency } from '../../domain/fx';
import { accountLots } from '../../domain/lot-accounting';
import { buildClosedLotViews, buildLotViews, ClosedLotView, LotView } from '../../domain/lot-valuation';
import { buildPriceResolver } from '../../domain/price-resolution';
import { exchangeCode, stripYahooSuffix } from '../../domain/ticker-match';
import { Transaction } from '../../domain/types';
import { MoneyPipe } from '../../shared/money.pipe';
import { LocalizedDatePipe } from '../../shared/localized-date.pipe';
import { LocalizedNumberPipe } from '../../shared/localized-number.pipe';
import { TableSort } from '../../shared/sort';
import { transactionTypeBadgeClass, transactionTypeLabel } from '../../shared/transaction-type';
import { InfoTooltipComponent } from '../../shared/ui/info-tooltip';
import { SortThComponent } from '../../shared/ui/sort-th';

interface HeaderView {
    readonly product: string;
    readonly ticker: string | null;
    readonly exchange: string | null;
    readonly open: boolean;
    readonly quantity: Decimal;
    readonly currentPrice: Decimal | null;
    readonly costBasis: Decimal | null;
    readonly costPerShare: Decimal | null;
    readonly value: Decimal | null;
    readonly unrealizedPnl: Decimal | null;
    readonly unrealizedPnlPct: Decimal | null;
    readonly realizedPnl: Decimal | null;
    readonly realizedCount: number;
    readonly priceDate: string | null;
    readonly priceLabel: string | null;
    readonly marketDataWarningText: string | null;
    readonly basisUnavailableText: string | null;
    readonly realizedUnavailableText: string | null;
    readonly realizedBasisAssumedZero: boolean;
}

interface TransactionView {
    readonly id: string;
    readonly rowIndex: number;
    readonly date: string;
    readonly time: string;
    readonly label: string;
    readonly badgeClass: string;
    readonly quantity: Decimal | null;
    readonly price: Decimal | null;
    readonly tradeCurrency: string | null;
    readonly amount: Decimal | null;
    readonly originalAmount: Decimal | null;
    readonly originalCurrency: string | null;
}

type LotSortKey = 'acquiredAt' | 'quantity' | 'costPerShare' | 'costBasis' | 'value' | 'pnl' | 'holdingDays';
type ClosedSortKey = 'soldAt' | 'quantity' | 'acquiredAt' | 'proceeds' | 'costBasis' | 'pnl';
type TransactionSortKey = 'date' | 'type' | 'quantity' | 'price' | 'amount';

@Component({
    selector: 'app-holding-detail-page',
    imports: [RouterLink, MoneyPipe, LocalizedDatePipe, LocalizedNumberPipe, InfoTooltipComponent, SortThComponent],
    templateUrl: './holding-detail-page.html',
})
export class HoldingDetailPage {
    private readonly context = inject(PortfolioContext);
    private readonly marketData = inject(MarketDataService);

    private readonly today = new Date().toISOString().slice(0, 10);

    readonly isin = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('isin') ?? '')), {
        initialValue: '',
    });

    readonly lotSort = new TableSort<LotSortKey, LotView>(
        {
            acquiredAt: (lot) => lot.acquiredAt,
            quantity: (lot) => lot.quantity,
            costPerShare: (lot) => lot.costPerShare,
            costBasis: (lot) => lot.costBasis,
            value: (lot) => lot.value,
            pnl: (lot) => lot.pnl,
            holdingDays: (lot) => lot.holdingDays,
        },
        'acquiredAt',
        'desc',
    );

    readonly closedSort = new TableSort<ClosedSortKey, ClosedLotView>(
        {
            soldAt: (match) => match.soldAt,
            quantity: (match) => match.quantity,
            acquiredAt: (match) => match.acquiredAt,
            proceeds: (match) => match.proceeds,
            costBasis: (match) => match.costBasis,
            pnl: (match) => match.pnl,
        },
        'soldAt',
        'desc',
    );

    readonly transactionSort = new TableSort<TransactionSortKey, TransactionView>(
        {
            date: (row) => `${row.date}T${row.time}#${String(row.rowIndex).padStart(8, '0')}`,
            type: (row) => row.label,
            quantity: (row) => row.quantity,
            price: (row) => row.price,
            amount: (row) => row.amount ?? row.originalAmount,
        },
        'date',
        'desc',
    );

    constructor() {
        void this.marketData.reload();
    }

    readonly reportingCurrency = computed(() => this.context.selectedPortfolio()?.reportingCurrency ?? 'EUR');
    readonly portfolioId = computed(() => this.context.selectedPortfolioId());

    private readonly transactions = computed(() => this.context.transactions().filter((txn) => txn.date <= this.today));

    private readonly accounting = computed(() =>
        accountLots(this.transactions(), {
            reportingCurrency: this.reportingCurrency(),
            fxFallback: this.marketData.fxResolver(),
        }),
    );

    readonly position = computed(() => this.accounting().positions.get(this.isin()) ?? null);

    private readonly resolvedPrice = computed(() => {
        const isin = this.isin();
        if (isin === '') {
            return null;
        }
        return buildPriceResolver(this.transactions(), this.marketData.quoteMap())(isin, this.today);
    });

    private readonly valuePerShare = computed<Decimal | null>(() => {
        const price = this.resolvedPrice();
        if (price === null) {
            return null;
        }
        const currency = this.reportingCurrency();
        const converted = convertToReportingCurrency(
            price.price,
            price.currency,
            this.today,
            currency,
            this.marketData.fxResolver(),
            price.transactionFxRate,
            buildImportedFxResolver(this.transactions(), currency),
        );
        return converted?.amount ?? null;
    });

    readonly lots = computed(() =>
        this.lotSort.apply(buildLotViews(this.position()?.lots ?? [], this.valuePerShare(), new Date())),
    );

    readonly closedLots = computed(() => this.closedSort.apply(buildClosedLotViews(this.position()?.closedLots ?? [])));

    readonly header = computed<HeaderView | null>(() => {
        const position = this.position();
        if (position === null) {
            return null;
        }
        const security = this.marketData.securities().find((s) => s.isin === position.isin);
        const quantity = position.lots.reduce((sum, lot) => sum.plus(lot.quantity), new Decimal(0));
        const open = !quantity.isZero();
        const basis = position.lots.reduce((sum, lot) => sum.plus(lot.basis), new Decimal(0));
        const costBasis = open && position.basisComplete ? basis : null;
        const valuePerShare = this.valuePerShare();
        const value = open && valuePerShare !== null ? quantity.times(valuePerShare) : null;
        const unrealizedPnl = value !== null && costBasis !== null ? value.minus(costBasis) : null;
        const unrealizedPnlPct =
            unrealizedPnl !== null && costBasis !== null && !costBasis.isZero()
                ? unrealizedPnl.div(costBasis).times(100)
                : null;
        const price = this.resolvedPrice();
        let marketDataWarningText: string | null = null;
        const currency = this.reportingCurrency();
        if (open && price === null) {
            marketDataWarningText = 'No quote or usable trade price is available, so values are unavailable.';
        } else if (open && price !== null) {
            if (valuePerShare === null) {
                marketDataWarningText = `The ${price.currency}/${currency} exchange rate is missing, so values are unavailable.`;
            } else if (price.provenance === 'trade') {
                marketDataWarningText = `Estimated from the latest trade price (${price.date ?? 'date unknown'}); no market quote is available.`;
            } else if (price.stale) {
                marketDataWarningText = `The cached market price from ${price.date ?? 'an unknown date'} may be stale.`;
            }
        }
        return {
            product: position.product,
            ticker:
                security?.quoteTicker !== null && security?.quoteTicker !== undefined
                    ? stripYahooSuffix(security.quoteTicker)
                    : null,
            exchange: security?.exchange ? exchangeCode(security.exchange) : null,
            open,
            quantity,
            currentPrice: valuePerShare,
            costBasis,
            costPerShare: costBasis !== null && !quantity.isZero() ? costBasis.div(quantity) : null,
            value,
            unrealizedPnl,
            unrealizedPnlPct,
            realizedPnl: position.realizedComplete ? position.realizedPnl : null,
            realizedCount: position.closedLots.length,
            priceDate: price?.date ?? null,
            priceLabel:
                price === null
                    ? 'Missing price'
                    : price.provenance === 'trade'
                      ? 'Estimated price'
                      : price.stale
                        ? 'Stale cached price'
                        : price.provenance === 'manual'
                          ? 'Manual price'
                          : price.provenance === 'cache'
                            ? 'Cached price'
                            : null,
            marketDataWarningText,
            basisUnavailableText: position.basisComplete
                ? null
                : 'Cost basis is unavailable because the imported transactions do not establish the full basis, such as a spin-off without broker basis or an oversell.',
            realizedUnavailableText: position.realizedComplete
                ? null
                : 'Realized P&L is unavailable because the imported transactions do not support complete lot accounting, such as an unknown corporate-action basis or an oversell.',
            realizedBasisAssumedZero: position.realizedBasisAssumedZero,
        };
    });

    readonly holdingTransactions = computed<TransactionView[]>(() => {
        const isin = this.isin();
        const currency = this.reportingCurrency();
        const fx = this.marketData.fxResolver();
        const rows = this.transactions()
            .filter((txn) => txn.isin === isin)
            .map((txn) => this.toTransactionView(txn, currency, fx));
        return this.transactionSort.apply(rows);
    });

    private toTransactionView(
        txn: Transaction,
        reportingCurrency: string,
        fx: (currency: string, date: string) => Decimal | null,
    ): TransactionView {
        const amount = mutationInReportingCurrency(txn, reportingCurrency, fx);
        const mutationCurrency = txn.mutationCurrency;
        const showOriginal =
            txn.mutation !== null &&
            mutationCurrency !== null &&
            mutationCurrency !== '' &&
            mutationCurrency !== reportingCurrency;
        return {
            id: txn.id,
            rowIndex: txn.rowIndex,
            date: txn.date,
            time: txn.time,
            label: transactionTypeLabel(txn.type),
            badgeClass: transactionTypeBadgeClass(txn.type),
            quantity: txn.quantity,
            price: txn.price,
            tradeCurrency: txn.tradeCurrency,
            amount,
            originalAmount: showOriginal ? txn.mutation : null,
            originalCurrency: showOriginal ? mutationCurrency : null,
        };
    }
}
