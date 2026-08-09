import Decimal from 'decimal.js';

export const TransactionTypes = {
    TradeBuy: 'TRADE_BUY',
    TradeSell: 'TRADE_SELL',
    CorporateBuy: 'CORPORATE_BUY',
    CorporateSell: 'CORPORATE_SELL',
    MmfConversionBuy: 'MMF_CONVERSION_BUY',
    MmfConversionSell: 'MMF_CONVERSION_SELL',
    MmfPriceChange: 'MMF_PRICE_CHANGE',
    FxDebit: 'FX_DEBIT',
    FxCredit: 'FX_CREDIT',
    Dividend: 'DIVIDEND',
    DividendTax: 'DIVIDEND_TAX',
    DividendReinvest: 'DIVIDEND_REINVEST',
    CapitalRepayment: 'CAPITAL_REPAYMENT',
    CapitalGainDistribution: 'CAPITAL_GAIN_DISTRIBUTION',
    TransactionFee: 'TRANSACTION_FEE',
    ConnectionFee: 'CONNECTION_FEE',
    TransactionTax: 'TRANSACTION_TAX',
    ExternalFee: 'EXTERNAL_FEE',
    InterestCharge: 'INTEREST_CHARGE',
    InterestIncome: 'INTEREST_INCOME',
    CashSweep: 'CASH_SWEEP',
    BankTransferText: 'BANK_TRANSFER_TEXT',
    Deposit: 'DEPOSIT',
    Withdrawal: 'WITHDRAWAL',
    Reservation: 'RESERVATION',
    Adjustment: 'ADJUSTMENT',
    Unknown: 'UNKNOWN',
} as const;

export type TransactionType = (typeof TransactionTypes)[keyof typeof TransactionTypes];

export type CorporateAction = 'STOCK_SPLIT' | 'SPIN_OFF' | 'PRODUCTWIJZIGING' | 'WIJZIGING_ISIN';

export interface Classification {
    readonly type: TransactionType;
    readonly corporateAction: CorporateAction | null;
    readonly quantity: Decimal | null;
    readonly price: Decimal | null;
    readonly tradeCurrency: string | null;
}

export interface RawCsvRow {
    readonly datum: string;
    readonly tijd: string;
    readonly valutadatum: string;
    readonly product: string;
    readonly isin: string;
    readonly omschrijving: string;
    readonly fx: string;
    readonly mutatieCurrency: string;
    readonly mutatie: string;
    readonly saldoCurrency: string;
    readonly saldo: string;
    readonly orderId: string;
    readonly rowIndex: number;
}

export interface Transaction {
    readonly id: string;
    readonly date: string;
    readonly time: string;
    readonly rowIndex: number;
    readonly product: string;
    readonly isin: string | null;
    readonly type: TransactionType;
    readonly corporateAction: CorporateAction | null;
    readonly quantity: Decimal | null;
    readonly price: Decimal | null;
    readonly tradeCurrency: string | null;
    readonly mutation: Decimal | null;
    readonly mutationCurrency: string | null;
    readonly balance: Decimal | null;
    readonly balanceCurrency: string | null;
    readonly fxRate: Decimal | null;
    readonly orderId: string | null;
    readonly description: string;
    readonly fingerprint: string;
}

export interface ImportWarning {
    readonly rowIndex: number;
    readonly description: string;
    readonly reason: string;
}
