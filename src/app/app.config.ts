import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { providePortfolioDatabase } from './data/db';
import { DemoSeedService } from './data/demo-seed.service';
import { MarketDataProvider } from './data/market-data-provider';
import { YahooMarketDataProvider } from './data/yahoo-market-data-provider';

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideRouter(routes),
        providePortfolioDatabase(),
        provideAppInitializer(() => inject(DemoSeedService).seed()),
        {
            provide: MarketDataProvider,
            useFactory: (): MarketDataProvider | null =>
                typeof location !== 'undefined' && location.hostname === 'localhost'
                    ? new YahooMarketDataProvider()
                    : null,
        },
    ],
};
