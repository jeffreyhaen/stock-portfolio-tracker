import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';
const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
    private readonly document = inject(DOCUMENT);

    private readonly systemDark = signal(prefersDark());

    readonly preference = signal<ThemePreference>(readStoredPreference());
    readonly theme = computed<ResolvedTheme>(() => {
        const preference = this.preference();
        return preference === 'system' ? (this.systemDark() ? 'dark' : 'light') : preference;
    });

    constructor() {
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            window.matchMedia(MEDIA_QUERY).addEventListener('change', (event) => {
                this.systemDark.set(event.matches);
                this.applyTheme();
            });
        }
        this.applyTheme();
    }

    toggle(): void {
        const next = ORDER[(ORDER.indexOf(this.preference()) + 1) % ORDER.length];
        this.preference.set(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // storage niet beschikbaar; voorkeur geldt alleen voor deze sessie
        }
        this.applyTheme();
    }

    private applyTheme(): void {
        this.document.documentElement.dataset['theme'] = this.theme() === 'dark' ? 'portfolio-dark' : 'portfolio';
    }
}

function prefersDark(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia(MEDIA_QUERY).matches
    );
}

function readStoredPreference(): ThemePreference {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === 'light' || value === 'dark' || value === 'system') {
            return value;
        }
    } catch {
        // storage niet beschikbaar
    }
    return 'system';
}
