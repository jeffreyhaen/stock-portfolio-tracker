import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PortfolioContext } from '../../data/portfolio-context';

@Component({
    selector: 'app-portfolio-redirect',
    template: '',
})
export class PortfolioRedirectComponent {
    constructor() {
        const route = inject(ActivatedRoute);
        const router = inject(Router);
        const context = inject(PortfolioContext);
        const target = String(route.snapshot.data['target']);
        void context.ready.then(() => {
            const id = context.selectedPortfolioId();
            void router.navigateByUrl(id === '' ? '/import' : `/portfolio/${id}/${target}`, { replaceUrl: true });
        });
    }
}
