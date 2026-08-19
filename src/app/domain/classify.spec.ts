import Decimal from 'decimal.js';
import { classifyDescription } from './classify';
import { TransactionTypes as T } from './types';

describe('classifyDescription', () => {
    describe('trades', () => {
        it('classifies a Buy with NL notation', () => {
            const result = classifyDescription('Koop 1.250 @ 4,80 EUR');
            expect(result.type).toBe(T.TradeBuy);
            expect(result.corporateAction).toBeNull();
            expect(result.quantity?.toFixed()).toBe('1250');
            expect(result.price?.toFixed()).toBe('4.8');
            expect(result.tradeCurrency).toBe('EUR');
        });

        it('classifies a Sell', () => {
            const result = classifyDescription('Verkoop 12 @ 0,1250 EUR');
            expect(result.type).toBe(T.TradeSell);
            expect(result.quantity?.toFixed()).toBe('12');
        });

        it.each([
            ['STOCK SPLIT: Verkoop 150 @ 4,00 EUR', T.CorporateSell, 'STOCK_SPLIT'],
            ['STOCK SPLIT: Koop 10 @ 60,00 EUR', T.CorporateBuy, 'STOCK_SPLIT'],
            ['SPIN-OFF: Koop 3 @ 11,11 USD', T.CorporateBuy, 'SPIN_OFF'],
            ['PRODUCTWIJZIGING : Koop 4 @ 9,77 USD', T.CorporateBuy, 'PRODUCT_CHANGE'],
            ['PRODUCTWIJZIGING : Verkoop 4 @ 9,77 USD', T.CorporateSell, 'PRODUCT_CHANGE'],
            ['WIJZIGING ISIN: Koop 10 @ 5,00 EUR', T.CorporateBuy, 'ISIN_CHANGE'],
            ['WIJZIGING ISIN: Verkoop 10 @ 5,00 USD', T.CorporateSell, 'ISIN_CHANGE'],
        ] as const)('%s', (description, type, action) => {
            const result = classifyDescription(description);
            expect(result.type).toBe(type);
            expect(result.corporateAction).toBe(action);
        });

        it('classifies the newer split adjustment format from the mutation sign', () => {
            const buy = classifyDescription(
                'SPLIT AANPASSING: 250 EXAMPLE HOLDINGS @ 12,50 EUR (XS0000000002)',
                new Decimal('-3125'),
            );
            const sell = classifyDescription(
                'SPLIT AANPASSING: 1.000 Example Holdings @ 3,125 EUR (XS0000000001)',
                new Decimal('3125'),
            );
            const formattingVariant = classifyDescription(
                'Split aanpassing: 2 Example Holdings @ 10 eur',
                new Decimal('-20'),
            );

            expect(buy.type).toBe(T.CorporateBuy);
            expect(buy.corporateAction).toBe('STOCK_SPLIT');
            expect(buy.quantity?.toFixed()).toBe('250');
            expect(sell.type).toBe(T.CorporateSell);
            expect(sell.corporateAction).toBe('STOCK_SPLIT');
            expect(sell.quantity?.toFixed()).toBe('1000');
            expect(formattingVariant.type).toBe(T.CorporateBuy);
            expect(formattingVariant.tradeCurrency).toBe('EUR');
        });
    });

    describe('money market fund', () => {
        it.each([
            ['Conversie geldmarktfonds: Koop 100 @ 1,0045 EUR', T.MmfConversionBuy, '100'],
            ['Conversie geldmarktfonds: Verkoop 12,49 @ 1,0045 EUR', T.MmfConversionSell, '12.49'],
        ] as const)('%s', (description, type, quantity) => {
            const result = classifyDescription(description);
            expect(result.type).toBe(type);
            expect(result.quantity?.toFixed()).toBe(quantity);
        });

        it('Money market fund price change', () => {
            expect(classifyDescription('Koersverandering geldmarktfonds (EUR)').type).toBe(T.MmfPriceChange);
        });
    });

    describe('exact texts', () => {
        it.each([
            ['Valuta Debitering', T.FxDebit],
            ['Valuta Creditering', T.FxCredit],
            ['Dividend', T.Dividend],
            ['Dividendbelasting', T.DividendTax],
            ['Dividend Herinvestering', T.DividendReinvest],
            ['Kapitaalsuitkering', T.CapitalRepayment],
            ['DEGIRO Transactiekosten en/of kosten van derden', T.TransactionFee],
            ['Transactiebelasting Frankrijk', T.TransactionTax],
            ['Flatex Interest', T.InterestCharge],
            ['Flatex Interest Income', T.InterestIncome],
            ['Rente', T.InterestIncome],
            ['Inkomsten uit Securities Lending - Januari', T.InterestIncome],
            ['Degiro Cash Sweep Transfer', T.CashSweep],
            ['Reservation iDEAL', T.Reservation],
            ['iDEAL Deposit', T.Deposit],
            ['iDEAL storting', T.Deposit],
            ['Processed Flatex Withdrawal', T.Withdrawal],
            ['Terugstorting', T.Withdrawal],
            ['flatex terugstorting', T.Withdrawal],
            ['Verrekening Welkomstactie', T.Adjustment],
        ] as const)('%s → %s', (description, type) => {
            expect(classifyDescription(description).type).toBe(type);
        });
    });

    describe('patterns', () => {
        it.each([
            ['Overboeking naar uw geldrekening bij flatexDEGIRO Bank: 2.522,79 EUR', T.BankTransferText],
            ['Overboeking van uw geldrekening bij flatexDEGIRO Bank 1.122,77 EUR', T.BankTransferText],
            ['DEGIRO Aansluitingskosten 2,50 (New York Stock Exchange - USD)', T.ConnectionFee],
            ['DEGIRO Aansluitingskosten 2,50 (Nasdaq - USD)', T.ConnectionFee],
            ['DEGIRO Aansluitingskosten 2,50 (Boerse Frankfurt - EUR)', T.ConnectionFee],
            ['DEGIRO Aansluitingskosten 2,50 (Xetra - EUR)', T.ConnectionFee],
            ['EUR/USD Externe Kosten', T.ExternalFee],
            ['USD Distribution Capital Gain', T.CapitalGainDistribution],
        ] as const)('%s → %s', (description, type) => {
            expect(classifyDescription(description).type).toBe(type);
        });
    });

    it('unknown texts never fail silently', () => {
        const result = classifyDescription('Iets totaal nieuws van DEGIRO');
        expect(result.type).toBe(T.Unknown);
        expect(result.quantity).toBeNull();
    });
});
