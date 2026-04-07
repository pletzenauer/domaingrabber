import axios from 'axios';
import type { ScraperAdapter, ScraperResult } from './index';

/**
 * Justiz-Webservice adapter (feature-flagged)
 *
 * This scraper integrates with the Austrian Justiz API for fetching
 * dissolution/insolvency records. It is only active when the following
 * environment variables are set:
 *
 *   JUSTIZ_API_ENABLED=true
 *   JUSTIZ_API_URL=<base URL of the Justiz API>
 *   JUSTIZ_API_KEY=<API key for authentication>
 *
 * The API is expected to return an array of records with at least:
 *   - name: string (company name)
 *   - gericht: string (court)
 *   - verfahren: string (proceeding type)
 *   - datum: string (date in ISO or DD.MM.YYYY format)
 *   - aktenzeichen: string (file reference)
 *
 * When the feature flag is disabled, run() returns an empty array.
 */

interface JustizApiRecord {
  name: string;
  gericht?: string;
  verfahren?: string;
  datum?: string;
  aktenzeichen?: string;
  url?: string;
  [key: string]: unknown;
}

function mapVerfahren(verfahren: string): string {
  const lower = verfahren.toLowerCase();
  if (lower.includes('konkurs') || lower.includes('insolvenz')) return 'insolvenz';
  if (lower.includes('liquidat')) return 'liquidation';
  if (lower.includes('lösch') || lower.includes('loesch')) return 'loeschung';
  if (lower.includes('sanier')) return 'sanierung';
  return 'insolvenz';
}

function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);

  const dotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  return new Date().toISOString().slice(0, 10);
}

export class JustizScraper implements ScraperAdapter {
  name = 'Justiz-Webservice';
  source = 'justiz_api';

  private get isEnabled(): boolean {
    return process.env.JUSTIZ_API_ENABLED === 'true';
  }

  private get apiUrl(): string {
    return process.env.JUSTIZ_API_URL || '';
  }

  private get apiKey(): string {
    return process.env.JUSTIZ_API_KEY || '';
  }

  async run(): Promise<ScraperResult[]> {
    if (!this.isEnabled) {
      console.log(
        `[${this.name}] Disabled (set JUSTIZ_API_ENABLED=true to activate)`
      );
      return [];
    }

    if (!this.apiUrl || !this.apiKey) {
      console.error(
        `[${this.name}] Enabled but JUSTIZ_API_URL or JUSTIZ_API_KEY is missing`
      );
      return [];
    }

    console.log(`[${this.name}] Fetching records from ${this.apiUrl}...`);

    try {
      const { data } = await axios.get<JustizApiRecord[]>(this.apiUrl, {
        timeout: 30_000,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'AustrianDomainWatch/1.0',
        },
      });

      if (!Array.isArray(data)) {
        console.error(`[${this.name}] Unexpected response format (not array)`);
        return [];
      }

      const results: ScraperResult[] = data
        .filter((record) => record.name)
        .map((record) => ({
          company_name: record.name,
          court: record.gericht || undefined,
          proceeding_type: mapVerfahren(record.verfahren || ''),
          gazette_date: parseDate(record.datum),
          source_url: record.url || undefined,
          source_ref: record.aktenzeichen || undefined,
          raw_data: record,
        }));

      console.log(`[${this.name}] Fetched ${results.length} records`);
      return results;
    } catch (err) {
      console.error(
        `[${this.name}] API request failed:`,
        err instanceof Error ? err.message : err
      );
      return [];
    }
  }
}
