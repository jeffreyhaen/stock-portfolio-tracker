import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { TickerSuggestion } from '../../data/market-data-provider';
import { MarketDataSyncService } from '../../data/market-data-sync.service';
import { TickerSearchComponent } from './ticker-search';

const rejectSync = {
    searchTicker: async (): Promise<TickerSuggestion[]> => {
        throw new Error('No market data provider is configured.');
    },
};

const stubSync = {
    searchTicker: async (): Promise<TickerSuggestion[]> => [
        { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', exchange: 'NASDAQ' },
    ],
};

describe('TickerSearchComponent', () => {
    let fixture: ComponentFixture<TickerSearchComponent>;

    function findButton(text: string): HTMLButtonElement | undefined {
        return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((button) =>
            button.textContent?.includes(text),
        );
    }

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TickerSearchComponent],
            providers: [{ provide: MarketDataSyncService, useValue: rejectSync }],
        }).compileComponents();
        fixture = TestBed.createComponent(TickerSearchComponent);
        fixture.autoDetectChanges();
    });

    it('offers the typed symbol directly when the search fails and manual entry is allowed', async () => {
        fixture.componentRef.setInput('allowManual', true);
        fixture.detectChanges();

        const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input');
        input!.value = 'asml.as';
        input!.dispatchEvent(new Event('input'));
        findButton('Find')!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();

        const manualButton = findButton("Use 'ASML.AS' directly");
        expect(manualButton).toBeDefined();

        const picks: TickerSuggestion[] = [];
        fixture.componentInstance.pick.subscribe((sug) => picks.push(sug));
        manualButton!.click();
        expect(picks).toEqual([{ symbol: 'ASML.AS', name: 'ASML.AS', exchange: '' }]);
    });

    it('does not offer a manual pick when manual entry is not allowed', async () => {
        const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input');
        input!.value = 'AMD';
        input!.dispatchEvent(new Event('input'));
        findButton('Find')!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();

        expect(findButton("Use 'AMD' directly")).toBeUndefined();
    });

    it('ignores manual picks without a query', () => {
        const picks: TickerSuggestion[] = [];
        fixture.componentInstance.pick.subscribe((sug) => picks.push(sug));
        fixture.componentInstance.pickManual();
        expect(picks).toEqual([]);
    });

    it('keeps the query and suggestions after a pick by default', async () => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [TickerSearchComponent],
            providers: [{ provide: MarketDataSyncService, useValue: stubSync }],
        }).compileComponents();
        fixture = TestBed.createComponent(TickerSearchComponent);
        fixture.autoDetectChanges();

        const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input');
        input!.value = 'AMD';
        input!.dispatchEvent(new Event('input'));
        findButton('Find')!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();

        const picks: TickerSuggestion[] = [];
        fixture.componentInstance.pick.subscribe((sug) => picks.push(sug));
        findButton('Advanced Micro Devices, Inc.')!.click();
        fixture.detectChanges();

        expect(picks).toHaveLength(1);
        expect(input!.value).toBe('AMD');
        expect((fixture.nativeElement as HTMLElement).querySelectorAll('ul li').length).toBeGreaterThan(0);
    });

    it('clears the query and suggestions after a pick when clearOnPick is set', async () => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [TickerSearchComponent],
            providers: [{ provide: MarketDataSyncService, useValue: stubSync }],
        }).compileComponents();
        fixture = TestBed.createComponent(TickerSearchComponent);
        fixture.componentRef.setInput('clearOnPick', true);
        fixture.autoDetectChanges();

        const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input');
        input!.value = 'AMD';
        input!.dispatchEvent(new Event('input'));
        findButton('Find')!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();

        const picks: TickerSuggestion[] = [];
        fixture.componentInstance.pick.subscribe((sug) => picks.push(sug));
        findButton('Advanced Micro Devices, Inc.')!.click();
        fixture.detectChanges();

        expect(picks).toHaveLength(1);
        expect(input!.value).toBe('');
        expect((fixture.nativeElement as HTMLElement).querySelectorAll('ul li').length).toBe(0);
    });
});
