import ExcelJS from 'exceljs';

export type Cell = string | number | null | undefined;

/**
 * One-sheet Excel workbook: bold header, filters, frozen header row and sensible widths.
 * Opens in Excel, and in Google Sheets via File → Import.
 */
export async function buildXlsx(sheetName: string, rows: Cell[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TEAM OS';
  workbook.created = new Date();
  // Excel limits sheet names to 31 characters and forbids a few symbols.
  const sheet = workbook.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report', { views: [{ state: 'frozen', ySplit: 1 }] });

  for (const row of rows) {
    // A leading = + - @ must stay text, never a formula.
    sheet.addRow(row.map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : (v ?? ''))));
  }
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F2' } };
  if (rows.length > 0 && rows[0].length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0].length } };
  }
  sheet.columns.forEach((column, i) => {
    const longest = Math.max(...rows.map((r) => String(r[i] ?? '').length), 6);
    column.width = Math.min(longest + 2, 50);
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** A file name that is safe on every operating system. */
export function exportFileName(title: string, extension: 'xlsx' | 'csv') {
  return `${title.replace(/[^\w\s-]+/g, '').replace(/\s+/g, '-').slice(0, 80) || 'report'}.${extension}`;
}
