import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavDropdownComponent } from './nav-dropdown';

@Component({
    imports: [NavDropdownComponent],
    template: `
        <app-nav-dropdown>
            <span dropdown-label>Tools</span>
            <a href="#" class="item">Projection</a>
        </app-nav-dropdown>
        <div id="outside"></div>
    `,
})
class HostComponent {}

describe('NavDropdownComponent', () => {
    function setup(): {
        fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
        el: HTMLElement;
        trigger: HTMLButtonElement;
    } {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        return { fixture, el, trigger: el.querySelector('button') as HTMLButtonElement };
    }

    it('opens and closes on trigger clicks', () => {
        const { fixture, el, trigger } = setup();
        expect(el.querySelector('[role="menu"]')).toBeNull();
        trigger.click();
        fixture.detectChanges();
        expect(el.querySelector('[role="menu"]')).not.toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        trigger.click();
        fixture.detectChanges();
        expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('closes on clicks outside the dropdown', () => {
        const { fixture, el, trigger } = setup();
        trigger.click();
        fixture.detectChanges();
        (el.querySelector('#outside') as HTMLElement).dispatchEvent(new Event('click', { bubbles: true }));
        fixture.detectChanges();
        expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('closes when an item inside the panel is clicked', () => {
        const { fixture, el, trigger } = setup();
        trigger.click();
        fixture.detectChanges();
        (el.querySelector('.item') as HTMLElement).click();
        fixture.detectChanges();
        expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('closes on Escape', () => {
        const { fixture, el, trigger } = setup();
        trigger.click();
        fixture.detectChanges();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();
        expect(el.querySelector('[role="menu"]')).toBeNull();
    });
});
