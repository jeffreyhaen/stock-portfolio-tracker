import { ImportService } from '../app/data/import.service';

export const MINI_CSV = [
    'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
    '01-01-2021,10:00,01-01-2021,,,iDEAL Deposit,,EUR,"50000,00",EUR,"50000,00",',
    '12-02-2026,10:00,12-02-2026,AMD,US0079031078,"Koop 12 @ 100,00 USD","1,2000",USD,"-1200,00",USD,"-1200,00",aaaaaaaa-1111-1111-1111-111111111111',
    '13-02-2026,10:00,13-02-2026,AMD,US0079031078,"Verkoop 2 @ 150,00 USD","1,2000",USD,"300,00",USD,"-900,00",bbbbbbbb-1111-1111-1111-111111111111',
    '14-02-2026,10:00,14-02-2026,ASML Holding NV ADR,USN070592100,"Koop 3 @ 500,00 EUR",,EUR,"-1500,00",EUR,"48500,00",cccccccc-1111-1111-1111-111111111111',
].join('\n');

export async function seedMiniCsv(importService: ImportService): Promise<void> {
    await importService.importCsv('p1', 'mini.csv', MINI_CSV);
}

export async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(predicate()).toBe(true);
}
