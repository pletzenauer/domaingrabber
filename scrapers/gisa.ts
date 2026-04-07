import axios from 'axios';
import { parse } from 'csv-parse/sync';
import type { ScraperAdapter, ScraperResult } from './index';

const CATALOG_API_URL =
  'https://data.gv.at/katalog/api/3/action/package_show?id=gisa';

interface CatalogResource {
  url: string;
  format: string;
  name: string;
}

interface CatalogResponse {
  success: boolean;
  result: {
    resources: CatalogResource[];
  };
}

interface GisaRow {
  GISA_ZAHL?: string;
  FIRMA?: string;
  PLZ?: string;
  ORT?: string;
  GEWERBE?: string;
  STATUS?: string;
  DATUM?: string;
  [key: string]: string | undefined;
}

function mapStatus(status: string): string | null {
  const lower = status.toLowerCase().trim();
  if (lower === 'erloschen') return 'gewerbe_erloschen';
  if (lower === 'ruhend') return 'gewerbe_ruhend';
  return null;
}

function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);

  // Try common Austrian date formats: DD.MM.YYYY, YYYY-MM-DD
  const dotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return new Date().toISOString().slice(0, 10);
}

async function findCsvUrl(): Promise<string> {
  const { data } = await axios.get<CatalogResponse>(CATALOG_API_URL, {
    timeout: 15_000,
  });

  if (!data.success || !data.result?.resources?.length) {
    throw new Error('GISA catalog API returned no resources');
  }

  // Prefer CSV format
  const csvResource = data.result.resources.find(
    (r) => r.format.toUpperCase() === 'CSV'
  );

  if (csvResource) return csvResource.url;

  // Fallback: any resource with .csv in the URL
  const csvByUrl = data.result.resources.find((r) =>
    r.url.toLowerCase().includes('.csv')
  );

  if (csvByUrl) return csvByUrl.url;

  throw new Error(
    'No CSV resource found in GISA catalog. Available formats: ' +
      data.result.resources.map((r) => r.format).join(', ')
  );
}

export class GisaScraper implements ScraperAdapter {
  name = 'GISA Open Data';
  source = 'gisa';

  async run(): Promise<ScraperResult[]> {
    console.log(`[${this.name}] Starting scrape...`);

    // Step 1: Find CSV resource URL from catalog
    const csvUrl = await findCsvUrl();
    console.log(`[${this.name}] CSV URL: ${csvUrl}`);

    // Step 2: Download CSV
    const { data: csvData } = await axios.get<string>(csvUrl, {
      timeout: 120_000,
      responseType: 'text',
      headers: { 'User-Agent': 'AustrianDomainWatch/1.0' },
      maxContentLength: 200 * 1024 * 1024, // 200 MB limit
    });

    console.log(
      `[${this.name}] Downloaded CSV: ${(csvData.length / 1024 / 1024).toFixed(1)} MB`
    );

    // Step 3: Parse CSV (Austrian CSVs often use semicolon delimiter)
    const rows: GisaRow[] = parse(csvData, {
      delimiter: ';',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    console.log(`[${this.name}] Parsed ${rows.length} total rows`);

    // Step 4: Filter for dissolved/dormant businesses
    const results: ScraperResult[] = [];

    for (const row of rows) {
      const status = row.STATUS || row.status || '';
      const proceedingType = mapStatus(status);

      if (!proceedingType) continue;

      const companyName = row.FIRMA || row.firma || '';
      if (!companyName) continue;

      const plz = row.PLZ || row.plz || '';
      const ort = row.ORT || row.ort || '';
      const courtLocation = [plz, ort].filter(Boolean).join(' ').trim();

      results.push({
        company_name: companyName,
        court: courtLocation || undefined,
        proceeding_type: proceedingType,
        gazette_date: parseDate(row.DATUM || row.datum),
        source_ref: row.GISA_ZAHL || row.gisa_zahl || undefined,
        source_url: `https://data.gv.at/katalog/dataset/gisa`,
        raw_data: {
          gisa_zahl: row.GISA_ZAHL || row.gisa_zahl,
          gewerbe: row.GEWERBE || row.gewerbe,
          plz,
          ort,
          status,
        },
      });
    }

    console.log(
      `[${this.name}] Filtered results: ${results.length} (erloschen/ruhend)`
    );
    return results;
  }
}
