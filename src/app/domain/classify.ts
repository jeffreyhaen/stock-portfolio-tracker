import { parseNlNumber } from './numbers';
import { Classification, CorporateAction, TransactionTypes as T, TransactionType } from './types';

const TRADE =
    /^(?:(STOCK SPLIT|SPIN-OFF|PRODUCTWIJZIGING|WIJZIGING ISIN)\s*:\s*)?(Koop|Verkoop)\s+([\d.,]+)\s*@\s*([\d.,]+)\s*([A-Z]{3})$/;
const MMF_CONVERSION = /^Conversie geldmarktfonds: (Koop|Verkoop)\s+([\d.,]+)\s*@\s*([\d.,]+)\s*([A-Z]{3})$/;
const MMF_PRICE_CHANGE = /^Koersverandering geldmarktfonds \([A-Z]{3}\)$/;
const CONNECTION_FEE = /^DEGIRO Aansluitingskosten [\d.,]+ \(.+ - [A-Z]{3}\)$/;
const EXTERNAL_FEE = /^[A-Z]{3}\/[A-Z]{3} Externe Kosten$/;
const CAPITAL_GAIN = /^[A-Z]{3} Distribution Capital Gain$/;

const CORPORATE_ACTIONS: Record<string, CorporateAction> = {
    'STOCK SPLIT': 'STOCK_SPLIT',
    'SPIN-OFF': 'SPIN_OFF',
    PRODUCTWIJZIGING: 'PRODUCTWIJZIGING',
    'WIJZIGING ISIN': 'WIJZIGING_ISIN',
};

const EXACT: Record<string, TransactionType> = {
    'Valuta Debitering': T.FxDebit,
    'Valuta Creditering': T.FxCredit,
    Dividend: T.Dividend,
    Dividendbelasting: T.DividendTax,
    'Dividend Herinvestering': T.DividendReinvest,
    Kapitaalsuitkering: T.CapitalRepayment,
    'DEGIRO Transactiekosten en/of kosten van derden': T.TransactionFee,
    'Transactiebelasting Frankrijk': T.TransactionTax,
    'Flatex Interest': T.InterestCharge,
    'Flatex Interest Income': T.InterestIncome,
    Rente: T.InterestIncome,
    'Degiro Cash Sweep Transfer': T.CashSweep,
    'Reservation iDEAL': T.Reservation,
    'iDEAL Deposit': T.Deposit,
    'iDEAL storting': T.Deposit,
    'Processed Flatex Withdrawal': T.Withdrawal,
    Terugstorting: T.Withdrawal,
    'flatex terugstorting': T.Withdrawal,
    'Verrekening Welkomstactie': T.Adjustment,
};

function classified(type: TransactionType): Classification {
    return { type, corporateAction: null, quantity: null, price: null, tradeCurrency: null };
}

export function classifyDescription(description: string): Classification {
    const text = description.trim().replace(/\s+/g, ' ');

    const trade = TRADE.exec(text);
    if (trade) {
        const corporateAction = trade[1] ? CORPORATE_ACTIONS[trade[1]] : null;
        const isBuy = trade[2] === 'Koop';
        let type: TransactionType = isBuy ? T.TradeBuy : T.TradeSell;
        if (corporateAction) {
            type = isBuy ? T.CorporateBuy : T.CorporateSell;
        }
        return {
            type,
            corporateAction,
            quantity: parseNlNumber(trade[3]),
            price: parseNlNumber(trade[4]),
            tradeCurrency: trade[5],
        };
    }

    const mmf = MMF_CONVERSION.exec(text);
    if (mmf) {
        return {
            type: mmf[1] === 'Koop' ? T.MmfConversionBuy : T.MmfConversionSell,
            corporateAction: null,
            quantity: parseNlNumber(mmf[2]),
            price: parseNlNumber(mmf[3]),
            tradeCurrency: mmf[4],
        };
    }

    const exact = EXACT[text];
    if (exact) {
        return classified(exact);
    }
    if (text.startsWith('Overboeking')) {
        return classified(T.BankTransferText);
    }
    if (MMF_PRICE_CHANGE.test(text)) {
        return classified(T.MmfPriceChange);
    }
    if (CONNECTION_FEE.test(text)) {
        return classified(T.ConnectionFee);
    }
    if (EXTERNAL_FEE.test(text)) {
        return classified(T.ExternalFee);
    }
    if (CAPITAL_GAIN.test(text)) {
        return classified(T.CapitalGainDistribution);
    }
    return classified(T.Unknown);
}
