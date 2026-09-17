import ExcelJS from 'exceljs';
import { buildXlsx, exportFileName } from './spreadsheet.js';

describe('Excel export', () => {
  it('writes a real workbook with a bold header and the data intact', async () => {
    const buffer = await buildXlsx('Weekly report', [
      ['Name', 'Completed', 'Note'],
      ['Sai', 4, '=HYPERLINK("x")'],
      ['Kushal', 0, null],
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Weekly report')!;
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getCell('A2').value).toBe('Sai');
    expect(sheet.getCell('B2').value).toBe(4);
    // Formula-looking text is kept as text, not executed.
    expect(sheet.getCell('C2').value).toBe('\'=HYPERLINK("x")');
    expect(sheet.rowCount).toBe(3);
  });

  it('makes safe file names', () => {
    expect(exportFileName('TEAM OS weekly report 2026-09-17', 'xlsx')).toBe('TEAM-OS-weekly-report-2026-09-17.xlsx');
    expect(exportFileName('a/b:c', 'csv')).toBe('abc.csv');
  });
});
