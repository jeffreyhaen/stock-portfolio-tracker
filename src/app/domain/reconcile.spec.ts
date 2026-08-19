import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv/parse-csv';
import { repairCsvRows } from './csv/repair-csv-rows';
import { buildLedger } from './ledger';
import { cashAt, externalFlows, positionsAt } from './engine';
import { PositionExpectation, reconcilePositions } from './reconcile';

const DEMO_CSV = join(process.cwd(), 'examples', 'demo', 'degiro-demo.csv');
const CUTOFF = '2021-12-31';

const EXPECTED_AT_CUTOFF: PositionExpectation[] = [
    { isin: 'US0378331005', quantity: '40' },
    { isin: 'US5949181045', quantity: '5' },
    { isin: 'IE00B3XXRP09', quantity: '8' },
    { isin: 'US02079K3059', quantity: '1' },
    { isin: 'NL0010273215', quantity: '2' },
    { isin: 'US7561091049', quantity: '20' },
];

const EXPECTED_AT_END: PositionExpectation[] = [
    { isin: 'US0378331005', quantity: '37' },
    { isin: 'US5949181045', quantity: '5' },
    { isin: 'IE00B3XXRP09', quantity: '5' },
    { isin: 'IE00BFMXXD54', quantity: '3' },
    { isin: 'US02079K3059', quantity: '20' },
    { isin: 'NL0010273215', quantity: '2' },
    { isin: 'US7561091049', quantity: '20' },
    { isin: 'IE00B4L5Y983', quantity: '2' },
    { isin: 'US67066G1040', quantity: '100' },
];

function loadDemoLedger() {
    const text = readFileSync(DEMO_CSV, 'utf-8');
    return buildLedger(repairCsvRows(parseCsv(text).map((row) => row.slice(0, 12))));
}

describe('reconciliation with the synthetic demo export', () => {
    const { transactions, warnings } = loadDemoLedger();

    it('reads a non-trivial synthetic ledger', () => {
        expect(transactions.length).toBeGreaterThan(70);
    });

    it('knows every description (no UNKNOWN)', () => {
        expect(warnings).toEqual([]);
    });

    it('matches positions at the historical cutoff', () => {
        const report = reconcilePositions(EXPECTED_AT_CUTOFF, positionsAt(transactions, CUTOFF));
        expect(report).toMatchObject({ mismatches: [], unexpectedOpen: [], ok: true });
    });

    it('matches ending positions', () => {
        const report = reconcilePositions(EXPECTED_AT_END, positionsAt(transactions));
        expect(report).toMatchObject({ mismatches: [], unexpectedOpen: [], ok: true });
    });

    it('matches ending cash per currency', () => {
        const cash = cashAt(transactions);
        expect(cash.get('EUR')?.amount.toFixed(2)).toBe('999.66');
        expect(cash.get('USD')?.amount.toFixed(2)).toBe('1000.00');
    });

    it('matches synthetic external flows', () => {
        const eur = externalFlows(transactions).get('EUR');
        expect(eur?.deposits.toFixed(2)).toBe('12500.00');
        expect(eur?.withdrawals.toFixed(2)).toBe('-300.00');
    });
});
