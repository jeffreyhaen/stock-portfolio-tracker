import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { providePortfolioDatabase } from './data/db';
import { QuoteProvider } from './data/quote-provider';
import { YahooQuoteProvider } from './data/yahoo-quote-provider';

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideRouter(routes),
        providePortfolioDatabase(),
        { provide: QuoteProvider, useClass: YahooQuoteProvider },
    ],
};
