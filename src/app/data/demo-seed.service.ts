import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { ImportService } from './import.service';
import { PortfolioDatabase } from './db';
import { PortfolioRepository } from './portfolio.repository';

const DEMO_SEED_KEY = 'demoSeedVersion';
const DEMO_SEED_VERSION = '1';
const DEMO_PORTFOLIO_NAME = 'Demo';
const DEMO_FILE_NAME = 'degiro-demo.csv';
const DEMO_HOSTNAME = 'jeffreyhaen.github.io';
const DEMO_PATH = '/stock-portfolio-tracker';

@Injectable({ providedIn: 'root' })
export class DemoSeedService {
    private readonly document = inject(DOCUMENT);
    private readonly db = inject(PortfolioDatabase);
    private readonly importService = inject(ImportService);
    private readonly portfolioRepository = inject(PortfolioRepository);

    async seed(): Promise<void> {
        if (!this.isGitHubPagesDemo()) {
            return;
        }

        const setting = await this.db.settings.get(DEMO_SEED_KEY);
        if (setting?.value === DEMO_SEED_VERSION) {
            return;
        }

        if ((await this.db.portfolios.count()) > 0) {
            await this.markSeeded();
            return;
        }

        try {
            const response = await fetch(new URL(`examples/demo/${DEMO_FILE_NAME}`, this.document.baseURI));
            if (!response.ok) {
                throw new Error(`Demo CSV request failed with status ${response.status}.`);
            }
            const csvText = await response.text();
            const portfolio = await this.portfolioRepository.create(DEMO_PORTFOLIO_NAME, 'EUR');
            await this.importService.importCsv(portfolio.id, DEMO_FILE_NAME, csvText);
            await this.markSeeded();
        } catch (error) {
            console.warn('Automatic demo import failed', error);
        }
    }

    private async markSeeded(): Promise<void> {
        await this.db.settings.put({ key: DEMO_SEED_KEY, value: DEMO_SEED_VERSION });
    }

    private isGitHubPagesDemo(): boolean {
        const { hostname, pathname } = this.document.location;
        return hostname === DEMO_HOSTNAME && (pathname === DEMO_PATH || pathname.startsWith(`${DEMO_PATH}/`));
    }
}
