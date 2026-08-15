import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'localizedDate', standalone: true })
export class LocalizedDatePipe implements PipeTransform {
    transform(isoDatum: string | null | undefined): string {
        if (isoDatum === null || isoDatum === undefined || isoDatum === '') {
            return '–';
        }
        const [year, month, day] = isoDatum.slice(0, 10).split('-');
        if (year === undefined || month === undefined || day === undefined) {
            return isoDatum;
        }
        return `${day}-${month}-${year}`;
    }
}
