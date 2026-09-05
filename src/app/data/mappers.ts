import Decimal from 'decimal.js';
import { ProjectionModel, ProjectionScenario, ProjectionScenarioRow } from '../domain/projection';
import { Transaction } from '../domain/types';
import {
    StoredProjectionModel,
    StoredProjectionScenario,
    StoredProjectionScenarioRow,
    StoredTransaction,
} from './stored-types';

export function toStored(txn: Transaction, portfolioId: string, batchId: string): StoredTransaction {
    return {
        portfolioId,
        batchId,
        rowIndex: txn.rowIndex,
        date: txn.date,
        time: txn.time,
        valueDate: txn.valueDate,
        isin: txn.isin,
        product: txn.product,
        type: txn.type,
        corporateAction: txn.corporateAction,
        rawDescription: txn.description,
        quantity: txn.quantity?.toFixed() ?? null,
        price: txn.price?.toFixed() ?? null,
        currency: txn.tradeCurrency,
        mutation: txn.mutation?.toFixed() ?? null,
        mutationCurrency: txn.mutationCurrency,
        balance: txn.balance?.toFixed() ?? null,
        balanceCurrency: txn.balanceCurrency,
        fxRate: txn.fxRate?.toFixed() ?? null,
        orderId: txn.orderId,
        fingerprint: txn.fingerprint,
    };
}

export function fromStored(stored: StoredTransaction): Transaction {
    return {
        id: stored.fingerprint,
        date: stored.date,
        time: stored.time,
        valueDate: stored.valueDate,
        rowIndex: stored.rowIndex,
        product: stored.product,
        isin: stored.isin,
        type: stored.type,
        corporateAction: stored.corporateAction,
        quantity: stored.quantity === null ? null : new Decimal(stored.quantity),
        price: stored.price === null ? null : new Decimal(stored.price),
        tradeCurrency: stored.currency,
        mutation: stored.mutation === null ? null : new Decimal(stored.mutation),
        mutationCurrency: stored.mutationCurrency,
        balance: stored.balance === null ? null : new Decimal(stored.balance),
        balanceCurrency: stored.balanceCurrency,
        fxRate: stored.fxRate === null ? null : new Decimal(stored.fxRate),
        orderId: stored.orderId,
        description: stored.rawDescription,
        fingerprint: stored.fingerprint,
    };
}

export function toStoredProjectionModel(model: ProjectionModel): StoredProjectionModel {
    return {
        symbol: model.symbol,
        updatedAt: new Date().toISOString(),
        baseYear: model.baseYear,
        baseRevenue: model.baseRevenue.toFixed(),
        baseNetIncome: model.baseNetIncome.toFixed(),
        currentPrice: model.currentPrice?.toFixed() ?? null,
        sharesOutstanding: model.sharesOutstanding?.toFixed() ?? null,
        projectedYears: model.projectedYears,
        scenarios: model.scenarios.map(toStoredProjectionScenario),
    };
}

export function fromStoredProjectionModel(stored: StoredProjectionModel): ProjectionModel {
    return {
        symbol: stored.symbol,
        baseYear: stored.baseYear,
        baseRevenue: new Decimal(stored.baseRevenue),
        baseNetIncome: new Decimal(stored.baseNetIncome),
        currentPrice: stored.currentPrice === null ? null : new Decimal(stored.currentPrice),
        sharesOutstanding: stored.sharesOutstanding === null ? null : new Decimal(stored.sharesOutstanding),
        projectedYears: stored.projectedYears,
        scenarios: stored.scenarios.map(fromStoredProjectionScenario),
    };
}

function toStoredProjectionScenario(scenario: ProjectionScenario): StoredProjectionScenario {
    return {
        name: scenario.name,
        rows: scenario.rows.map(toStoredProjectionScenarioRow),
    };
}

function fromStoredProjectionScenario(stored: StoredProjectionScenario): ProjectionScenario {
    return {
        name: stored.name,
        rows: stored.rows.map(fromStoredProjectionScenarioRow),
    };
}

function toStoredProjectionScenarioRow(row: ProjectionScenarioRow): StoredProjectionScenarioRow {
    return {
        revenueGrowthPct: row.revenueGrowthPct?.toFixed() ?? null,
        netMarginPct: row.netMarginPct?.toFixed() ?? null,
        peLow: row.peLow.toFixed(),
        peHigh: row.peHigh.toFixed(),
    };
}

function fromStoredProjectionScenarioRow(stored: StoredProjectionScenarioRow): ProjectionScenarioRow {
    return {
        revenueGrowthPct: stored.revenueGrowthPct === null ? null : new Decimal(stored.revenueGrowthPct),
        netMarginPct: stored.netMarginPct === null ? null : new Decimal(stored.netMarginPct),
        peLow: new Decimal(stored.peLow),
        peHigh: new Decimal(stored.peHigh),
    };
}
