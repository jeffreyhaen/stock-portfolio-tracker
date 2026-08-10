import Decimal from 'decimal.js';
import { FxResolver } from './fx';
import { Transaction, TransactionTypes as T } from './types';

const BUY_TYPES = new Set<string>([T.TradeBuy, T.CorporateBuy]);
const SELL_TYPES = new Set<string>([T.TradeSell, T.CorporateSell]);
const EXTERNAL_TYPES = new Set<string>([T.Deposit, T.Withdrawal]);

export interface PriceBar {
    readonly datum: string;
    readonly slotkoers: Decimal;
    readonly valuta: string;
}

export interface MarketValuePoint {
    readonly datum: string;
    readonly value: Decimal | null;
    readonly flow: Decimal;
    readonly netInvested: Decimal;
}

export interface MarketValueSeries {
    readonly punten: MarketValuePoint[];
    readonly ontbrekendeFx: string[];
    readonly geschatteIsins: string[];
}

interface AnchorEvent {
    readonly datum: string;
    readonly prijs: Decimal;
    readonly valuta: string;
}

interface TradeEvent {
    readonly datum: string;
    readonly isin: string;
    readonly delta: Decimal;
}

interface CashEvent {
    readonly datum: string;
    readonly saldo: Decimal;
}

interface FlowEvent {
    readonly datum: string;
    readonly bedrag: Decimal;
}

export interface SplitFactor {
    readonly datum: string;
    readonly factor: Decimal;
}

function compareChronological(a: Transaction, b: Transaction): number {
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex;
}

export function buildMarketValueSeries(
    transactions: readonly Transaction[],
    bars: ReadonlyMap<string, readonly PriceBar[]>,
    fx: FxResolver,
    splits: ReadonlyMap<string, readonly SplitFactor[]> = new Map(),
): MarketValueSeries {
    const gesorteerd = [...transactions].sort(compareChronological);
    const trades: TradeEvent[] = [];
    const anchors = new Map<string, AnchorEvent[]>();
    const cashEvents: CashEvent[] = [];
    const flows = new Map<string, Decimal>();
    let netInvestedTotaal = new Decimal(0);
    const netInvestedEvents: FlowEvent[] = [];

    for (const txn of gesorteerd) {
        if (txn.isin !== null && txn.quantity !== null) {
            if (BUY_TYPES.has(txn.type)) {
                trades.push({ datum: txn.date, isin: txn.isin, delta: txn.quantity });
            } else if (SELL_TYPES.has(txn.type)) {
                trades.push({ datum: txn.date, isin: txn.isin, delta: txn.quantity.negated() });
            }
            if (
                (BUY_TYPES.has(txn.type) || SELL_TYPES.has(txn.type)) &&
                txn.price !== null &&
                txn.tradeCurrency !== null
            ) {
                const lijst = anchors.get(txn.isin) ?? [];
                lijst.push({ datum: txn.date, prijs: txn.price, valuta: txn.tradeCurrency });
                anchors.set(txn.isin, lijst);
            }
        }
        if (txn.balanceCurrency === 'EUR' && txn.balance !== null) {
            cashEvents.push({ datum: txn.date, saldo: txn.balance });
        }
        if (EXTERNAL_TYPES.has(txn.type) && txn.mutation !== null && txn.mutationCurrency === 'EUR') {
            flows.set(txn.date, (flows.get(txn.date) ?? new Decimal(0)).plus(txn.mutation));
            netInvestedTotaal = netInvestedTotaal.plus(txn.mutation);
            netInvestedEvents.push({ datum: txn.date, bedrag: netInvestedTotaal });
        }
    }

    const tradesPerIsin = new Map<string, TradeEvent[]>();
    for (const trade of trades) {
        const lijst = tradesPerIsin.get(trade.isin) ?? [];
        lijst.push(trade);
        tradesPerIsin.set(trade.isin, lijst);
    }

    const dagen = new Set<string>();
    for (const lijst of bars.values()) {
        for (const bar of lijst) {
            dagen.add(bar.datum);
        }
    }
    const gesorteerdeDagen = [...dagen].sort();
    const ontbrekendeFx = new Set<string>();
    const punten: MarketValuePoint[] = [];
    const eersteRelevantieDatum = gesortedeerdeEersteDatum(gesorteerd);

    const prijsState = new Map<string, { index: number; laatste: PriceBar | null }>();
    for (const isin of bars.keys()) {
        prijsState.set(isin, { index: 0, laatste: null });
    }
    const anchorState = new Map<string, { index: number; laatste: AnchorEvent | null }>();
    for (const isin of anchors.keys()) {
        anchorState.set(isin, { index: 0, laatste: null });
    }
    const geschatteIsins = new Set<string>();
    const qtyState = new Map<string, { index: number; qty: Decimal }>();
    for (const isin of tradesPerIsin.keys()) {
        qtyState.set(isin, { index: 0, qty: new Decimal(0) });
    }
    let cashIndex = 0;
    let cash = new Decimal(0);
    let netInvestedIndex = 0;
    let netInvested = new Decimal(0);

    for (const dag of gesorteerdeDagen) {
        if (dag < eersteRelevantieDatum) {
            continue;
        }
        while (cashIndex < cashEvents.length && cashEvents[cashIndex].datum <= dag) {
            cash = cashEvents[cashIndex].saldo;
            cashIndex++;
        }
        while (netInvestedIndex < netInvestedEvents.length && netInvestedEvents[netInvestedIndex].datum <= dag) {
            netInvested = netInvestedEvents[netInvestedIndex].bedrag;
            netInvestedIndex++;
        }
        for (const [isin, state] of qtyState) {
            const lijst = tradesPerIsin.get(isin) ?? [];
            while (state.index < lijst.length && lijst[state.index].datum <= dag) {
                state.qty = state.qty.plus(lijst[state.index].delta);
                state.index++;
            }
        }
        for (const [isin, state] of prijsState) {
            const lijst = bars.get(isin) ?? [];
            while (state.index < lijst.length && lijst[state.index].datum <= dag) {
                state.laatste = lijst[state.index];
                state.index++;
            }
        }
        for (const [isin, state] of anchorState) {
            const lijst = anchors.get(isin) ?? [];
            while (state.index < lijst.length && lijst[state.index].datum <= dag) {
                state.laatste = lijst[state.index];
                state.index++;
            }
        }
        let totaal = cash;
        let compleet = true;
        for (const [isin, qtyInfo] of qtyState) {
            const qty = qtyInfo.qty;
            if (qty.isZero()) {
                continue;
            }
            const bar = prijsState.get(isin)?.laatste ?? null;
            let prijs: Decimal;
            let valuta: string;
            let aantal = qty;
            if (bar !== null) {
                prijs = bar.slotkoers;
                valuta = bar.valuta;
                for (const split of splits.get(isin) ?? []) {
                    if (split.datum > dag) {
                        aantal = aantal.times(split.factor);
                    }
                }
            } else {
                const anchor = anchorState.get(isin)?.laatste ?? null;
                if (anchor === null) {
                    compleet = false;
                    break;
                }
                prijs = anchor.prijs;
                valuta = anchor.valuta;
                geschatteIsins.add(isin);
            }
            const rate = fx(valuta, dag);
            if (rate === null) {
                ontbrekendeFx.add(`${valuta}/EUR`);
                compleet = false;
                break;
            }
            totaal = totaal.plus(aantal.times(prijs).times(rate));
        }
        punten.push({
            datum: dag,
            value: compleet ? totaal : null,
            flow: flows.get(dag) ?? new Decimal(0),
            netInvested,
        });
    }

    return { punten, ontbrekendeFx: [...ontbrekendeFx], geschatteIsins: [...geschatteIsins] };
}

function gesortedeerdeEersteDatum(transactions: readonly Transaction[]): string {
    let min = '';
    for (const txn of transactions) {
        if (min === '' || txn.date < min) {
            min = txn.date;
        }
    }
    return min;
}
