import axios from 'axios';
import { parse } from 'csv-parse/sync';
import type { ScraperAdapter, ScraperResult } from './index';

const CATALOG_API_URL =
  'https://data.gv.at/katalog/api/3/action/package_show?id=gisa';

interface CatalogResource {
  url: string;
  format: string;
  name: string;
  description?: string;
}

interface CatalogResponse {
  success: boolean;
  result: {
    resources: CatalogResource[];
  };
}

/**
 * Map GISA status to our proceeding type.
 * Returns null if the status is not relevant (i.e., the business is still active).
 */
function mapStatus(status: string): string | null {
  const lower = status.toLowerCase().trim();
  if (lower === 'erloschen' || lower === 'gewerbe erloschen') return 'gewerbe_erloschen';
  if (lower === 'ruhend' || lower === 'gewerbe ruhend') return 'gewerbe_ruhend';
  if (lower === 'gelöscht' || lower === 'geloescht') return 'gewerbe_erloschen';
  if (lower === 'zurückgelegt' || lower === 'zurueckgelegt') return 'gewerbe_erloschen';
  if (lower === 'entzogen') return 'gewerbe_erloschen';
  return null;
}

/**
 * Parse date strings in various Austrian/European formats to ISO YYYY-MM-DD.
 */
function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);

  const trimmed = dateStr.trim();

  // DD.MM.YYYY
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  // DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD-MM-YYYY
  const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, day, month, year] = dashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Generic Date parse fallback
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return new Date().toISOString().slice(0, 10);
}

/**
 * Find the CSV download URL from the GISA catalog API.
 */
async function findCsvUrl(): Promise<string> {
  console.log(`[GISA] Fetching catalog metadata from ${CATALOG_API_URL}...`);

  const { data } = await axios.get<CatalogResponse>(CATALOG_API_URL, {
    timeout: 15_000,
    headers: { 'User-Agent': 'AustrianDomainWatch/1.0' },
  });

  if (!data.success || !data.result?.resources?.length) {
    throw new Error('GISA catalog API returned no resources');
  }

  console.log(`[GISA] Found ${data.result.resources.length} resources in catalog:`);
  for (const r of data.result.resources) {
    console.log(`  - ${r.name} (${r.format}): ${r.url}`);
  }

  // Prefer CSV format (case-insensitive)
  const csvResource = data.result.resources.find(
    (r) => r.format.toUpperCase() === 'CSV'
  );
  if (csvResource) return csvResource.url;

  // Fallback: any resource with .csv in the URL
  const csvByUrl = data.result.resources.find((r) =>
    r.url.toLowerCase().includes('.csv')
  );
  if (csvByUrl) return csvByUrl.url;

  // Fallback: try the first resource regardless of format
  const firstResource = data.result.resources[0];
  console.warn(`[GISA] No CSV resource found. Trying first resource: ${firstResource.format} - ${firstResource.url}`);
  return firstResource.url;
}

/**
 * Detect the CSV delimiter by examining the first few lines.
 */
function detectDelimiter(csvText: string): string {
  const firstLines = csvText.split('\n').slice(0, 5).join('\n');

  // Count potential delimiters in the header line
  const headerLine = csvText.split('\n')[0] || '';
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const pipeCount = (headerLine.match(/\|/g) || []).length;

  console.log(`[GISA] Delimiter detection - semicolons: ${semicolonCount}, commas: ${commaCount}, tabs: ${tabCount}, pipes: ${pipeCount}`);

  // Austrian government CSVs most commonly use semicolons
  if (semicolonCount >= commaCount && semicolonCount >= tabCount && semicolonCount > 0) return ';';
  if (tabCount >= commaCount && tabCount >= semicolonCount && tabCount > 0) return '\t';
  if (pipeCount >= commaCount && pipeCount > 0) return '|';
  if (commaCount > 0) return ',';

  // Default to semicolon for Austrian data
  return ';';
}

/**
 * Find a column value by trying multiple possible names (case-insensitive).
 * Austrian government CSVs may use different column name conventions.
 */
function findColumn(row: Record<string, string | undefined>, ...candidates: string[]): string {
  for (const candidate of candidates) {
    // Try exact match first
    if (row[candidate] !== undefined) return row[candidate] || '';
    // Try case-insensitive
    const key = Object.keys(row).find(k => k.toLowerCase() === candidate.toLowerCase());
    if (key && row[key] !== undefined) return row[key] || '';
  }
  return '';
}

/**
 * Find a column value using partial match (contains).
 */
function findColumnPartial(row: Record<string, string | undefined>, ...partials: string[]): string {
  for (const partial of partials) {
    const key = Object.keys(row).find(k => k.toLowerCase().includes(partial.toLowerCase()));
    if (key && row[key] !== undefined) return row[key] || '';
  }
  return '';
}

export class GisaScraper implements ScraperAdapter {
  name = 'GISA Open Data';
  source = 'gisa';

  async run(): Promise<ScraperResult[]> {
    console.log(`[${this.name}] Starting scrape...`);

    // Step 1: Find CSV resource URL from catalog
    const csvUrl = await findCsvUrl();
    console.log(`[${this.name}] CSV URL: ${csvUrl}`);

    // Step 2: Download CSV with streaming support for large files
    console.log(`[${this.name}] Downloading CSV (this may take a while for large files)...`);
    const { data: csvData, headers } = await axios.get<string>(csvUrl, {
      timeout: 300_000, // 5 minutes for large files
      responseType: 'text',
      headers: { 'User-Agent': 'AustrianDomainWatch/1.0' },
      maxContentLength: 500 * 1024 * 1024, // 500 MB limit
    });

    const contentType = headers['content-type'] || '';
    const sizeInMb = (csvData.length / 1024 / 1024).toFixed(1);
    console.log(`[${this.name}] Downloaded: ${sizeInMb} MB (Content-Type: ${contentType})`);

    // Step 3: Detect delimiter and parse
    const delimiter = detectDelimiter(csvData);
    console.log(`[${this.name}] Detected delimiter: ${JSON.stringify(delimiter)}`);

    // Log the first line (header) for debugging
    const firstLine = csvData.split('\n')[0]?.trim();
    console.log(`[${this.name}] CSV header: ${firstLine?.slice(0, 300)}`);

    let rows: Record<string, string | undefined>[];
    try {
      rows = parse(csvData, {
        delimiter,
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
        // Handle quoted fields
        quote: '"',
        escape: '"',
        // Skip comment lines
        comment: '#',
      });
    } catch (parseErr) {
      console.error(`[${this.name}] CSV parse failed with delimiter ${JSON.stringify(delimiter)}:`,
        parseErr instanceof Error ? parseErr.message : parseErr);

      // Retry with alternative delimiters
      const altDelimiters = [';', ',', '\t', '|'].filter(d => d !== delimiter);
      let parsed = false;
      for (const altDelim of altDelimiters) {
        try {
          console.log(`[${this.name}] Retrying with delimiter ${JSON.stringify(altDelim)}...`);
          rows = parse(csvData, {
            delimiter: altDelim,
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true,
            bom: true,
            quote: '"',
            escape: '"',
          });
          console.log(`[${this.name}] Successfully parsed with delimiter ${JSON.stringify(altDelim)}`);
          parsed = true;
          break;
        } catch {
          continue;
        }
      }
      if (!parsed) {
        throw new Error(`Failed to parse CSV with any delimiter. First line: ${firstLine?.slice(0, 200)}`);
      }
    }

    console.log(`[${this.name}] Parsed ${rows!.length} total rows`);

    // Log available columns for debugging
    if (rows!.length > 0) {
      const columns = Object.keys(rows![0]!);
      console.log(`[${this.name}] CSV columns: ${columns.join(', ')}`);
    }

    // Step 4: Filter for dissolved/dormant businesses
    const results: ScraperResult[] = [];
    let statusFieldUsed = '';
    let companyFieldUsed = '';

    for (const row of rows!) {
      // Find status field (try many variations)
      const status = findColumn(row,
        'STATUS', 'status', 'Status',
        'GEWERBESTATUS', 'Gewerbestatus', 'gewerbestatus',
        'GEWERBEZUSTAND', 'Gewerbezustand',
        'ZUSTAND', 'Zustand', 'zustand'
      ) || findColumnPartial(row, 'status', 'zustand', 'state');

      if (!statusFieldUsed && status) {
        // Log which field we found the status in (once)
        const statusKey = Object.keys(row).find(k =>
          k.toLowerCase().includes('status') || k.toLowerCase().includes('zustand')
        );
        statusFieldUsed = statusKey || 'unknown';
        console.log(`[${this.name}] Using status field: "${statusFieldUsed}" (sample value: "${status}")`);
      }

      const proceedingType = mapStatus(status);
      if (!proceedingType) continue;

      // Find company name field
      const companyName = findColumn(row,
        'FIRMA', 'firma', 'Firma',
        'FIRMENNAME', 'Firmenname', 'firmenname',
        'NAME', 'name', 'Name',
        'BEZEICHNUNG', 'Bezeichnung', 'bezeichnung',
        'UNTERNEHMEN', 'Unternehmen',
        'BETRIEBSNAME', 'Betriebsname'
      ) || findColumnPartial(row, 'firma', 'name', 'bezeichn', 'unternehm', 'betrieb');

      if (!companyName) continue;

      if (!companyFieldUsed) {
        const nameKey = Object.keys(row).find(k =>
          k.toLowerCase().includes('firma') || k.toLowerCase().includes('name')
        );
        companyFieldUsed = nameKey || 'unknown';
        console.log(`[${this.name}] Using company name field: "${companyFieldUsed}" (sample: "${companyName}")`);
      }

      // Find location fields
      const plz = findColumn(row, 'PLZ', 'plz', 'Plz', 'POSTLEITZAHL', 'Postleitzahl')
        || findColumnPartial(row, 'plz', 'postleitz');
      const ort = findColumn(row, 'ORT', 'ort', 'Ort', 'GEMEINDE', 'Gemeinde', 'STADT', 'Stadt')
        || findColumnPartial(row, 'ort', 'gemeinde', 'stadt', 'city');
      const courtLocation = [plz, ort].filter(Boolean).join(' ').trim();

      // Find date field
      const dateStr = findColumn(row,
        'DATUM', 'datum', 'Datum',
        'ENDDATUM', 'Enddatum', 'enddatum',
        'ENDEDATUM', 'Endedatum',
        'AENDERUNGSDATUM', 'Aenderungsdatum',
        'ERLOESCHDATUM', 'Erloeschdatum',
        'LOESCHDATUM', 'Loeschdatum',
        'STATUSDATUM', 'Statusdatum'
      ) || findColumnPartial(row, 'datum', 'date', 'ende', 'erlosch', 'lösch');

      // Find GISA reference number
      const gisaZahl = findColumn(row,
        'GISA_ZAHL', 'gisa_zahl', 'Gisa_Zahl',
        'GISA-ZAHL', 'GISAZAHL', 'Gisazahl',
        'GISA_NR', 'GISA_NUMMER',
        'NR', 'NUMMER', 'nummer'
      ) || findColumnPartial(row, 'gisa', 'zahl', 'nummer');

      // Find trade/business type
      const gewerbe = findColumn(row,
        'GEWERBE', 'gewerbe', 'Gewerbe',
        'GEWERBEART', 'Gewerbeart',
        'TAETIGKEIT', 'Taetigkeit', 'Tätigkeit',
        'BRANCHE', 'Branche'
      ) || findColumnPartial(row, 'gewerbe', 'taetigk', 'tätigk', 'branche');

      results.push({
        company_name: companyName,
        court: courtLocation || undefined,
        proceeding_type: proceedingType,
        gazette_date: parseDate(dateStr || undefined),
        source_ref: gisaZahl || undefined,
        source_url: 'https://data.gv.at/katalog/dataset/gisa',
        raw_data: {
          gisa_zahl: gisaZahl || undefined,
          gewerbe: gewerbe || undefined,
          plz: plz || undefined,
          ort: ort || undefined,
          status,
        },
      });
    }

    console.log(`[${this.name}] Filtered results: ${results.length} (erloschen/ruhend/geloescht)`);

    // Log some stats about status distribution
    const statusCounts: Record<string, number> = {};
    for (const r of results) {
      statusCounts[r.proceeding_type] = (statusCounts[r.proceeding_type] || 0) + 1;
    }
    console.log(`[${this.name}] Status distribution:`, statusCounts);

    return results;
  }
}
