// ─── CSV export helpers ───

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let cell = typeof value === "string" ? value : String(value);
  // Neutralize spreadsheet formula injection.
  if (FORMULA_PREFIX.test(cell)) cell = `'${cell}`;
  if (NEEDS_QUOTING.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => formatCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => formatCell(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}

export function sanitizeFilename(name: string, fallback = "export"): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return clean || fallback;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
