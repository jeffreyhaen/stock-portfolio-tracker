import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortfolioContext } from './data/portfolio-context';

@Component({
    selector: 'app-root',
    imports: [RouterOutlet, RouterLink, RouterLinkActive],
    templateUrl: './app.html',
    styleUrl: './app.css',
})
export class App {
    private readonly context = inject(PortfolioContext);

    readonly portfolioId = this.context.selectedPortfolioId;
    readonly portfolioNaam = computed(() => this.context.selectedPortfolio()?.naam ?? '');
}
