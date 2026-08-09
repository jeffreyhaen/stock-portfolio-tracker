import { inject, Injectable } from '@angular/core';
import { PortfolioDatabase } from './db';
import { StoredPortfolio } from './stored-types';

@Injectable({ providedIn: 'root' })
export class PortfolioRepository {
    private readonly db = inject(PortfolioDatabase);

    async list(): Promise<StoredPortfolio[]> {
        const portfolios = await this.db.portfolios.toArray();
        return portfolios.sort((a, b) => a.naam.localeCompare(b.naam));
    }

    async create(naam: string, rapportagevaluta: string): Promise<StoredPortfolio> {
        const portfolio: StoredPortfolio = {
            id: crypto.randomUUID(),
            naam,
            rapportagevaluta,
            aangemaaktOp: new Date().toISOString(),
        };
        await this.db.portfolios.add(portfolio);
        return portfolio;
    }
}
