import * as XLSX from 'xlsx';

// List the sheet/tab names of an Excel file, in the browser. `bookSheets: true`
// reads only the workbook directory (names), not every cell — cheap even for
// large files. Returns [] on failure so the caller can fall back gracefully.
export async function readSheetNames(file) {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', bookSheets: true });
    return wb.SheetNames || [];
  } catch {
    return [];
  }
}
