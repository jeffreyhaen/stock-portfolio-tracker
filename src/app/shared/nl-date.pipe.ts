import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'nlDate', standalone: true })
export class NlDatePipe implements PipeTransform {
    transform(isoDatum: string | null | undefined): string {
        if (isoDatum === null || isoDatum === undefined || isoDatum === '') {
            return '–';
        }
        const [jaar, maand, dag] = isoDatum.split('-');
        if (jaar === undefined || maand === undefined || dag === undefined) {
            return isoDatum;
        }
        return `${dag}-${maand}-${jaar}`;
    }
}
