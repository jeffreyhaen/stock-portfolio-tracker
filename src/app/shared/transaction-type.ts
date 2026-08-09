import { TransactionType, TransactionTypes as T } from '../domain/types';

const SOFT_BLUE = 'bg-[#e6effe] text-[#0068f0]';
const SOFT_AMBER = 'bg-[#fdf3e0] text-[#b25c00]';
const SOFT_GREEN = 'bg-[#dff7ec] text-[#0a8a52]';
const SOFT_GREY = 'bg-[#eef1f5] text-[#5b6472]';
const SOFT_RED = 'bg-[#fdeaea] text-[#901010]';

interface TypePresentatie {
    readonly label: string;
    readonly badgeClass: string;
}

const PRESENTATIE: Record<TransactionType, TypePresentatie> = {
    [T.TradeBuy]: { label: 'Buy', badgeClass: SOFT_BLUE },
    [T.TradeSell]: { label: 'Sell', badgeClass: SOFT_AMBER },
    [T.CorporateBuy]: { label: 'Buy', badgeClass: SOFT_BLUE },
    [T.CorporateSell]: { label: 'Sell', badgeClass: SOFT_AMBER },
    [T.Dividend]: { label: 'Dividend', badgeClass: SOFT_GREEN },
    [T.DividendReinvest]: { label: 'Dividend reinvestment', badgeClass: SOFT_GREEN },
    [T.CapitalRepayment]: { label: 'Capital repayment', badgeClass: SOFT_GREEN },
    [T.CapitalGainDistribution]: { label: 'Capital gain distribution', badgeClass: SOFT_GREEN },
    [T.InterestIncome]: { label: 'Interest', badgeClass: SOFT_GREEN },
    [T.DividendTax]: { label: 'Withholding tax', badgeClass: SOFT_GREY },
    [T.TransactionFee]: { label: 'Fee', badgeClass: SOFT_GREY },
    [T.ConnectionFee]: { label: 'Fee', badgeClass: SOFT_GREY },
    [T.TransactionTax]: { label: 'Transaction tax', badgeClass: SOFT_GREY },
    [T.ExternalFee]: { label: 'Fee', badgeClass: SOFT_GREY },
    [T.InterestCharge]: { label: 'Interest charge', badgeClass: SOFT_GREY },
    [T.FxDebit]: { label: 'Currency conversion', badgeClass: SOFT_GREY },
    [T.FxCredit]: { label: 'Currency conversion', badgeClass: SOFT_GREY },
    [T.MmfConversionBuy]: { label: 'Currency conversion', badgeClass: SOFT_GREY },
    [T.MmfConversionSell]: { label: 'Currency conversion', badgeClass: SOFT_GREY },
    [T.MmfPriceChange]: { label: 'Currency conversion', badgeClass: SOFT_GREY },
    [T.CashSweep]: { label: 'Cash sweep', badgeClass: SOFT_GREY },
    [T.BankTransferText]: { label: 'Bank transfer', badgeClass: SOFT_GREY },
    [T.Reservation]: { label: 'Reservation', badgeClass: SOFT_GREY },
    [T.Adjustment]: { label: 'Adjustment', badgeClass: SOFT_GREY },
    [T.Deposit]: { label: 'Deposit', badgeClass: SOFT_GREEN },
    [T.Withdrawal]: { label: 'Withdrawal', badgeClass: SOFT_RED },
    [T.Unknown]: { label: 'Unknown', badgeClass: SOFT_GREY },
};

export function transactionTypeLabel(type: TransactionType): string {
    return PRESENTATIE[type].label;
}

export function transactionTypeBadgeClass(type: TransactionType): string {
    return PRESENTATIE[type].badgeClass;
}
