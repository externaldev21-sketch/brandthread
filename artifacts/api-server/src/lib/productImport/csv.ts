/**
 * Pure RFC-4180 CSV parser used by product import. No I/O.
 *
 * Handles: UTF-8/UTF-16 BOM, CRLF / LF / lone CR line breaks, quoted fields
 * with embedded delimiters, newlines and doubled quotes, trailing blank
 * lines, ragged rows, and delimiter sniffing between `,` `;` tab and `|`.
 */

export const DELIMITERS = [",", ";", "\t", "|"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export class CsvParseError extends Error {
  constructor(public code: "UNTERMINATED_QUOTE" | "EMPTY", message: string, public line?: number) {
    super(message);
    this.name = "CsvParseError";
  }
}

export type ParsedCsv = {
  delimiter: Delimiter;
  /** Raw header cells, trimmed, BOM removed. */
  headers: string[];
  /** Data records. Each has exactly headers.length cells (short rows padded, long rows kept). */
  rows: string[][];
  /** 1-based line number in the source file where each data record starts. */
  lineNumbers: number[];
};

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Picks the delimiter that produces the most consistent multi-column split of the first lines. */
export function sniffDelimiter(text: string): Delimiter {
  const sample = stripBom(text).slice(0, 64 * 1024);
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = recordFieldCounts(sample, delimiter, 8);
    if (!counts.length || counts[0] < 2) continue;
    const consistent = counts.filter((count) => count === counts[0]).length;
    // More columns in the header and more rows agreeing with it wins.
    const score = counts[0] * 1000 + consistent;
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

function recordFieldCounts(text: string, delimiter: string, maxRecords: number): number[] {
  const counts: number[] = [];
  let fields = 1;
  let quoted = false;
  let sawContent = false;
  for (let i = 0; i < text.length && counts.length < maxRecords; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++; else quoted = false;
      }
      continue;
    }
    if (ch === '"') { quoted = true; sawContent = true; }
    else if (ch === delimiter) { fields++; sawContent = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (sawContent) counts.push(fields);
      fields = 1;
      sawContent = false;
    } else sawContent = true;
  }
  return counts;
}

export function parseCsv(input: string, options: { delimiter?: Delimiter } = {}): ParsedCsv {
  const text = stripBom(input);
  if (!text.trim()) throw new CsvParseError("EMPTY", "The file is empty.");
  const delimiter = options.delimiter ?? sniffDelimiter(text);

  const records: string[][] = [];
  const starts: number[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let fieldWasQuoted = false;
  let line = 1;
  let recordLine = 1;
  let recordHasContent = false;

  const endField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    if (recordHasContent || record.some((cell) => cell !== "")) {
      records.push(record);
      starts.push(recordLine);
    }
    record = [];
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "" && !fieldWasQuoted) {
      quoted = true; fieldWasQuoted = true; recordHasContent = true;
    } else if (ch === delimiter) {
      endField(); recordHasContent = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (quoted) {
    throw new CsvParseError("UNTERMINATED_QUOTE", `A quoted value starting near line ${recordLine} never closes.`, recordLine);
  }
  if (field !== "" || record.length || fieldWasQuoted) endRecord();

  if (!records.length) throw new CsvParseError("EMPTY", "The file is empty.");
  const headers = records[0].map((header) => header.trim());
  const width = headers.length;
  const rows = records.slice(1).map((row) => {
    if (row.length >= width) return row;
    return [...row, ...Array<string>(width - row.length).fill("")];
  });
  return { delimiter, headers, rows, lineNumbers: starts.slice(1) };
}
