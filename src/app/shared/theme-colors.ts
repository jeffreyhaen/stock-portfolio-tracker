export function themeColor(name: string, fallback: string): string {
    if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
        return fallback;
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value === '' ? fallback : value;
}

export function withAlpha(color: string, alpha: number): string {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    if (hex === null) {
        return color;
    }
    const value = parseInt(hex[1], 16);
    const r = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
