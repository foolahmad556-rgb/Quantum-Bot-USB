export type ReportValue = string | number | boolean | null;
export type Report = Record<string, ReportValue | Record<string, ReportValue>>;

function validate(report: Report): void {
  if (typeof report.runId !== 'string' || report.runId.length === 0) throw new Error('runId is required');
}

export function exportReportJson(report: Report): string {
  validate(report);
  return JSON.stringify(report, null, 2) + '\n';
}

function flatten(value: ReportValue | Record<string, ReportValue>, prefix = ''): Array<[string, ReportValue]> {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => flatten(nested, prefix ? `${prefix}.${key}` : key));
  }
  return [[prefix, value]];
}

function csvCell(value: ReportValue): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportReportCsv(report: Report): string {
  validate(report);
  return [['runId', 'value'], ...Object.entries(report).flatMap(([key, value]) => flatten(value, key))]
    .map((row) => row.map(csvCell).join(','))
    .join('\n') + '\n';
}
