import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { PortfolioContext } from '../../data/portfolio-context';

@Component({
    selector: 'app-portfolio-shell',
    imports: [RouterOutlet],
    template: '<router-outlet />',
})
export class PortfolioShellComponent {
    constructor() {
        const route = inject(ActivatedRoute);
        const router = inject(Router);
        const context = inject(PortfolioContext);
        route.paramMap.subscribe((params) => {
            const id = params.get('portfolioId') ?? '';
            void context.ready.then(() => {
                const bestaat = context.portfolios().some((p) => p.id === id);
                if (!bestaat) {
                    void router.navigateByUrl('/import', { replaceUrl: true });
                    return;
                }
                if (context.selectedPortfolioId() !== id) {
                    context.select(id);
                }
            });
        });
    }
}
