import axios from 'axios';
import * as cheerio from 'cheerio';
import type { ScraperAdapter, ScraperResult } from './index';

const BASE_URL = 'https://edikte.justiz.gv.at';
const USER_AGENT = 'Mozilla/5.0 (compatible; AustrianDomainWatch/1.0)';
const REQUEST_TIMEOUT = 30_000;

/**
 * Format a Date as DD.MM.YYYY for the search query.
 */
function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

/**
 * Convert DD.MM.YYYY to ISO YYYY-MM-DD.
 */
function toIsoDate(dateStr: string): string {
  const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the search URL using the submitSuche agent.
 *
 * The Ediktsdatei uses a Lotus Domino agent that accepts:
 *   - datum=DD.MM.YYYY  → publications since that date
 *   - BMAZ=NUL          → both first entries and changes
 *   - BL=NUL            → all federal states
 *   - subf=eid          → simple search
 *   - scope=edi         → edicts scope
 *   - Anw=ID            → insolvency database
 */
function buildSearchUrl(dateStr: string): string {
  const params = new URLSearchParams({
    OpenAgent: '',
    subf: 'eid',
    scope: 'edi',
    Anw: 'ID',
    datum: dateStr,
    SchuldnerS: '',
    BMAZ: 'NUL',
    BL: 'NUL',
    SearchMax: '4999',
    SearchOrder: '4',
  });
  return `${BASE_URL}/edikte/id/idedi8.nsf/submitSuche?${params.toString()}`;
}

/**
 * Classify a case number into proceeding type.
 */
function classifyType(caseNumber: string): string {
  const lower = caseNumber.toLowerCase();
  if (lower.includes(' se ')) return 'insolvenz_eroeffnung';
  if (lower.includes(' s ')) return 'insolvenz';
  return 'insolvenz';
}

/**
 * Extract court name from a case number string like "BG Kufstein, 6 S 46/24p"
 */
function extractCourt(caseText: string): string {
  // The case number format: "CourtType Location, CaseNumber"
  const commaIdx = caseText.indexOf(',');
  return commaIdx > 0 ? caseText.substring(0, commaIdx).trim() : caseText.trim();
}

/**
 * Check if a debtor name looks like a company (vs natural person).
 * Companies typically end with GmbH, KG, OG, AG, e.U., etc.
 */
function isCompany(name: string): boolean {
  const companyPatterns = /\b(gmbh|kg|og|ag|e\.?\s?u\.?|gen\.?m\.?b\.?h|ges\.?m\.?b\.?h|co\.?\s?kg|stiftung|verein|genossenschaft)\b/i;
  return companyPatterns.test(name);
}

/**
 * Parse search results from the submitSuche response HTML.
 *
 * The results are in a table inside #ergebnisliste with structure:
 *   <tr>
 *     <td class="zentriert">counter</td>
 *     <td><a href="0/UNID!OpenDocument">CourtType Location, CaseNumber</a></td>
 *     <td>Debtor Name<br>Optional occupation<br>ZIP City</td>
 *   </tr>
 */
function parseResults(html: string, queryDate: string): ScraperResult[] {
  const $ = cheerio.load(html);
  const results: ScraperResult[] = [];

  // Get total hits from hidden field
  const totalHits = $('input[name="TotalHits"]').val();
  console.log(`[Ediktsdatei] Total hits: ${totalHits}`);

  // Parse the results table inside #ergebnisliste
  $('#ergebnisliste table tbody tr, #ergebnisliste table tr').each((_i, el) => {
    const cells = $(el).find('td');
    if (cells.length < 3) return;

    // Column 2: Case number with link to document
    const caseLink = $(cells[1]).find('a').first();
    const caseText = caseLink.text().trim();
    const docHref = caseLink.attr('href') || '';

    // Column 3: Debtor name + address
    // The HTML has <br> separating lines: Name<br>Occupation<br>ZIP City
    const debtorHtml = $(cells[2]).html() || '';
    const debtorLines = debtorHtml
      .split(/<br\s*\/?>/)
      .map((line) => cheerio.load(line).text().trim())
      .filter(Boolean);

    if (!caseText || debtorLines.length === 0) return;

    const debtorName = debtorLines[0];
    const location = debtorLines[debtorLines.length - 1]; // Last line is usually the address

    // Skip if debtor name is empty or too short
    if (!debtorName || debtorName.length < 2) return;

    // Extract UNID from the document link for deduplication
    const unidMatch = docHref.match(/([0-9a-f]{32})/i);
    const unid = unidMatch ? unidMatch[1] : undefined;

    const court = extractCourt(caseText);
    const sourceUrl = unid
      ? `${BASE_URL}/edikte/id/idedi8.nsf/0/${unid}`
      : undefined;

    results.push({
      company_name: debtorName,
      court: court || undefined,
      proceeding_type: classifyType(caseText),
      gazette_date: queryDate,
      source_url: sourceUrl,
      source_ref: unid || caseText,
      raw_data: {
        case_number: caseText,
        debtor_lines: debtorLines,
        location: location !== debtorName ? location : undefined,
        is_company: isCompany(debtorName),
      },
    });
  });

  return results;
}

export class EdiktsdateiScraper implements ScraperAdapter {
  name = 'Ediktsdatei';
  source = 'ediktsdatei';

  async run(): Promise<ScraperResult[]> {
    console.log(`[${this.name}] Starting scrape...`);

    const allResults: ScraperResult[] = [];
    const seenRefs = new Set<string>();

    // Get the available publication dates from the search form
    // The form shows 3 date buttons for recent publication dates
    const dates = await this.getPublicationDates();

    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i];
      const isoDate = toIsoDate(dateStr);
      const url = buildSearchUrl(dateStr);

      console.log(`[${this.name}] Searching publications from ${dateStr}...`);

      try {
        const { data: html } = await axios.get<string>(url, {
          timeout: REQUEST_TIMEOUT,
          headers: { 'User-Agent': USER_AGENT },
          responseType: 'text',
        });

        const results = parseResults(html, isoDate);

        // Deduplicate by source_ref (UNID or case number)
        let added = 0;
        for (const r of results) {
          const key = r.source_ref || `${r.company_name}|${r.gazette_date}`;
          if (!seenRefs.has(key)) {
            seenRefs.add(key);
            allResults.push(r);
            added++;
          }
        }

        console.log(`[${this.name}] Date ${dateStr}: ${results.length} results, ${added} new`);
      } catch (err) {
        console.error(`[${this.name}] Failed for ${dateStr}:`,
          err instanceof Error ? err.message : err);
      }

      // Rate limiting between requests
      if (i < dates.length - 1) {
        await sleep(1500);
      }
    }

    // Log stats
    const companies = allResults.filter((r) => r.raw_data?.is_company);
    const persons = allResults.filter((r) => !r.raw_data?.is_company);
    console.log(`[${this.name}] Total: ${allResults.length} results (${companies.length} companies, ${persons.length} natural persons)`);

    return allResults;
  }

  /**
   * Get the available publication dates from the search form.
   * The Ediktsdatei shows 3 date buttons on the search page.
   * Falls back to last 7 days if we can't fetch the form.
   */
  private async getPublicationDates(): Promise<string[]> {
    try {
      const { data: html } = await axios.get<string>(
        `${BASE_URL}/edikte/id/idedi8.nsf/suche!OpenForm&subf=eid`,
        {
          timeout: REQUEST_TIMEOUT,
          headers: { 'User-Agent': USER_AGENT },
          responseType: 'text',
        }
      );

      const $ = cheerio.load(html);
      const dates: string[] = [];

      // The date buttons are submit inputs with name="datum"
      $('input[name="datum"]').each((_i, el) => {
        const val = $(el).attr('value') || '';
        if (val.match(/\d{2}\.\d{2}\.\d{4}/)) {
          dates.push(val);
        }
      });

      if (dates.length > 0) {
        console.log(`[${this.name}] Found publication dates: ${dates.join(', ')}`);
        return dates;
      }
    } catch (err) {
      console.warn(`[${this.name}] Could not fetch publication dates:`,
        err instanceof Error ? err.message : err);
    }

    // Fallback: generate last 5 weekday dates
    console.log(`[${this.name}] Using fallback dates (last 5 weekdays)`);
    const dates: string[] = [];
    const today = new Date();
    let daysBack = 0;
    while (dates.length < 5 && daysBack < 14) {
      const d = new Date(today);
      d.setDate(today.getDate() - daysBack);
      // Skip weekends (Sat=6, Sun=0)
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.push(formatDate(d));
      }
      daysBack++;
    }
    return dates;
  }
}
