import axios from 'axios';
import * as cheerio from 'cheerio';
import type { ScraperAdapter, ScraperResult } from './index';

const BASE_URL = 'https://edikte.justiz.gv.at';
const SEARCH_BASE = `${BASE_URL}/edikte/id/idedi8.nsf/suchedi!SearchView`;
const USER_AGENT = 'AustrianDomainWatch/1.0';
const REQUEST_TIMEOUT = 30_000;

/**
 * Format a Date as DD.MM.YYYY for the Ediktsdatei search query (FELD9 parameter).
 */
function formatDateForQuery(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Convert DD.MM.YYYY or other date formats to ISO YYYY-MM-DD.
 */
function parseToIsoDate(dateStr: string): string {
  // DD.MM.YYYY
  const dotMatch = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // YYYY-MM-DD
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  // Fallback
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * Classify the proceeding type from German text.
 */
function classifyProceedingType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('konkurs') || lower.includes('insolvenz')) return 'insolvenz';
  if (lower.includes('liquidat')) return 'liquidation';
  if (lower.includes('lösch') || lower.includes('loesch')) return 'loeschung';
  if (lower.includes('sanier')) return 'sanierung';
  if (lower.includes('schulden')) return 'insolvenz';
  return 'insolvenz';
}

/**
 * Extract court name from text.
 */
function extractCourt(text: string): string | undefined {
  const match = text.match(
    /(Landesgericht|Bezirksgericht|Handelsgericht|LG|BG|HG)\s+[\wäöüÄÖÜß\-]+/i
  );
  return match ? match[0].trim() : undefined;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the search URL for a specific date using FELD9 (publication date field).
 */
function buildDateSearchUrl(dateStr: string, maxResults: number = 200): string {
  // FELD9 is the publication date field in the Ediktsdatei Lotus Notes database
  const query = `[FELD9]=${dateStr}`;
  return `${SEARCH_BASE}&Query=${encodeURIComponent(query)}&SearchMax=${maxResults}&SearchOrder=4`;
}

/**
 * Build the search URL for insolvency edicts (FIELD2=1 = Ersteintraege).
 */
function buildInsolvencySearchUrl(maxResults: number = 200): string {
  const query = 'FIELD2=1';
  return `${SEARCH_BASE}&Query=${encodeURIComponent(query)}&SearchMax=${maxResults}&SearchOrder=4`;
}

/**
 * Fetch a page with standard headers and error handling.
 */
async function fetchPage(url: string): Promise<string> {
  const { data } = await axios.get<string>(url, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
    },
    // Lotus Domino may return various encodings
    responseType: 'text',
  });
  return data;
}

/**
 * Extract document links (UNIDs) from the search results HTML.
 * The Lotus Domino search results page embeds document links in various formats.
 */
function extractDocumentLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const seenUrls = new Set<string>();

  // Strategy 1: Look for links containing document UNIDs (32-char hex strings)
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    // Lotus Notes document URLs typically contain /0/ followed by a UNID
    if (href.match(/\/[0-9a-f]{32}/i) || href.includes('.nsf/')) {
      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
      if (!seenUrls.has(fullUrl)) {
        seenUrls.add(fullUrl);
        links.push(fullUrl);
      }
    }
  });

  // Strategy 2: Look for UNIDs in JavaScript code (AJAX loading)
  const unidPattern = /[0-9A-F]{32}/g;
  const scriptBlocks = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scriptBlocks) {
    const matches = script.match(unidPattern);
    if (matches) {
      for (const unid of matches) {
        // Filter out common false positives (all zeros, etc.)
        if (unid === '00000000000000000000000000000000') continue;
        const docUrl = `${BASE_URL}/edikte/id/idedi8.nsf/0/${unid}`;
        if (!seenUrls.has(docUrl)) {
          seenUrls.add(docUrl);
          links.push(docUrl);
        }
      }
    }
  }

  // Strategy 3: Look for form actions or data attributes with document references
  $('[data-unid], [data-id], [data-href]').each((_i, el) => {
    const unid = $(el).attr('data-unid') || $(el).attr('data-id') || '';
    if (unid.match(/^[0-9a-f]{32}$/i)) {
      const docUrl = `${BASE_URL}/edikte/id/idedi8.nsf/0/${unid}`;
      if (!seenUrls.has(docUrl)) {
        seenUrls.add(docUrl);
        links.push(docUrl);
      }
    }
  });

  return links;
}

/**
 * Extract the total hits count from the search results page.
 */
function extractTotalHits(html: string): number {
  const $ = cheerio.load(html);
  // Look for the TotalHits hidden input
  const totalHitsInput = $('input[name="TotalHits"]').val();
  if (totalHitsInput) {
    const count = parseInt(String(totalHitsInput), 10);
    if (!isNaN(count)) return count;
  }
  // Try regex fallback
  const match = html.match(/TotalHits['"]\s*value\s*=\s*['"](\d+)/i);
  if (match) return parseInt(match[1], 10);
  return 0;
}

/**
 * Parse a single document page to extract edict information.
 */
function parseDocumentPage(html: string, sourceUrl: string): ScraperResult | null {
  const $ = cheerio.load(html);

  // The document page typically has the edict details in various formats.
  // Try multiple extraction strategies.

  let companyName = '';
  let court = '';
  let dateStr = '';
  let fullText = '';

  // Strategy 1: Look for structured table data
  $('table td, div.field, span.field, div.content, td.content').each((_i, el) => {
    const text = $(el).text().trim();
    if (text) fullText += ' ' + text;
  });

  // If no structured content found, use the body text
  if (!fullText.trim()) {
    fullText = $('body').text();
  }

  // Strategy 2: Look for labeled fields (common in Lotus Notes views)
  // "Firma:", "Schuldner:", "Gemeinschuldner:", etc.
  const companyPatterns = [
    /(?:Firma|Schuldner|Gemeinschuldner|Unternehmen|Name)[:\s]+([^\n\r,;]{3,100})/i,
    /(?:betreffend|betrifft|über das Vermögen)[:\s]+(?:der|des|die)?\s*([^\n\r,;]{3,100})/i,
  ];

  for (const pattern of companyPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      companyName = match[1].trim();
      break;
    }
  }

  // Extract court
  const courtMatch = fullText.match(
    /((?:Landes|Bezirks|Handels)gericht\s+[\wäöüÄÖÜß\s\-]+?)(?:[,.\s]|$)/i
  );
  if (courtMatch) {
    court = courtMatch[1].trim();
  }

  // Extract date
  const dateMatch = fullText.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
  if (dateMatch) {
    dateStr = dateMatch[1];
  }

  // Also try to extract from page title or heading
  const title = $('title').text().trim() || $('h1, h2, h3').first().text().trim();
  if (!companyName && title) {
    // Use title as company name if nothing else found
    companyName = title.replace(/^Edikt\s*[-:]\s*/i, '').trim();
  }

  if (!companyName) return null;

  return {
    company_name: companyName,
    court: court || extractCourt(fullText) || undefined,
    proceeding_type: classifyProceedingType(fullText),
    gazette_date: dateStr ? parseToIsoDate(dateStr) : new Date().toISOString().slice(0, 10),
    source_url: sourceUrl,
    raw_data: {
      title,
      textPreview: fullText.slice(0, 500).trim(),
    },
  };
}

/**
 * Try to extract results directly from the search results page HTML,
 * without fetching individual document pages. This works when the search
 * results page includes inline previews/snippets.
 */
function extractResultsFromSearchPage(html: string, queryDate: string): ScraperResult[] {
  const $ = cheerio.load(html);
  const results: ScraperResult[] = [];

  // Lotus Domino search results often render as table rows or div blocks
  // with document previews

  // Strategy 1: Table rows with multiple cells
  $('table tr').each((_i, el) => {
    const cells = $(el).find('td');
    if (cells.length < 2) return;

    const rowText = $(el).text().trim();
    // Skip header rows
    if (rowText.toLowerCase().includes('firma') && rowText.toLowerCase().includes('gericht')) return;

    const linkEl = $(el).find('a[href]').first();
    const href = linkEl.attr('href') || '';
    const linkText = linkEl.text().trim();

    // The first meaningful cell often contains the company name
    let companyName = '';
    let courtText = '';

    if (cells.length >= 3) {
      companyName = $(cells[0]).text().trim();
      courtText = $(cells[1]).text().trim();
    } else if (linkText && linkText.length > 3) {
      companyName = linkText;
    }

    if (!companyName || companyName.length < 3) return;
    // Skip obvious navigation/header text
    if (/^(suche|ergebnis|seite|zurück|weiter|nr\.?|datum)/i.test(companyName)) return;

    const sourceUrl = href.startsWith('http')
      ? href
      : href ? `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}` : undefined;

    results.push({
      company_name: companyName,
      court: courtText || extractCourt(rowText) || undefined,
      proceeding_type: classifyProceedingType(rowText),
      gazette_date: queryDate,
      source_url: sourceUrl,
      source_ref: sourceUrl || undefined,
      raw_data: { rowText: rowText.slice(0, 300) },
    });
  });

  // Strategy 2: Div-based results (some Domino views use divs)
  $('div.searchResult, div.edikt, div.entry, div[class*="result"]').each((_i, el) => {
    const text = $(el).text().trim();
    const linkEl = $(el).find('a[href]').first();
    const href = linkEl.attr('href') || '';
    const linkText = linkEl.text().trim();

    const companyName = linkText || text.split('\n')[0]?.trim() || '';
    if (!companyName || companyName.length < 3) return;

    const sourceUrl = href.startsWith('http')
      ? href
      : href ? `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}` : undefined;

    results.push({
      company_name: companyName,
      court: extractCourt(text) || undefined,
      proceeding_type: classifyProceedingType(text),
      gazette_date: queryDate,
      source_url: sourceUrl,
      raw_data: { textPreview: text.slice(0, 300) },
    });
  });

  return results;
}

/**
 * Strategy A: Date-based search for the last N days.
 * Fetches the search results page for each date and extracts results.
 */
async function scrapeByDate(daysBack: number = 7): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];
  const today = new Date();

  for (let i = 0; i < daysBack; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = formatDateForQuery(date);
    const isoDate = parseToIsoDate(dateStr);
    const url = buildDateSearchUrl(dateStr);

    console.log(`[Ediktsdatei] Fetching date ${dateStr}...`);

    try {
      const html = await fetchPage(url);
      const totalHits = extractTotalHits(html);
      console.log(`[Ediktsdatei] Date ${dateStr}: ${totalHits} total hits`);

      // First try to extract results directly from the search page
      const pageResults = extractResultsFromSearchPage(html, isoDate);
      if (pageResults.length > 0) {
        console.log(`[Ediktsdatei] Extracted ${pageResults.length} results from search page for ${dateStr}`);
        results.push(...pageResults);
        continue;
      }

      // If no inline results, try fetching individual document pages
      const docLinks = extractDocumentLinks(html);
      if (docLinks.length > 0) {
        console.log(`[Ediktsdatei] Found ${docLinks.length} document links for ${dateStr}`);
        // Limit to first 50 to avoid overwhelming the server
        const linksToFetch = docLinks.slice(0, 50);
        for (const docUrl of linksToFetch) {
          try {
            await sleep(500); // Rate limiting
            const docHtml = await fetchPage(docUrl);
            const result = parseDocumentPage(docHtml, docUrl);
            if (result) {
              result.gazette_date = isoDate;
              results.push(result);
            }
          } catch (docErr) {
            console.warn(`[Ediktsdatei] Failed to fetch document ${docUrl}:`,
              docErr instanceof Error ? docErr.message : docErr);
          }
        }
      } else if (totalHits > 0) {
        // We know results exist but couldn't extract them - log for debugging
        console.warn(`[Ediktsdatei] ${totalHits} hits for ${dateStr} but could not extract results. HTML length: ${html.length}`);
        // Save the raw search page info as a single result for visibility
        results.push({
          company_name: `[Ediktsdatei batch: ${totalHits} Edikte vom ${dateStr}]`,
          proceeding_type: 'insolvenz',
          gazette_date: isoDate,
          source_url: url,
          raw_data: {
            totalHits,
            note: 'Could not extract individual results from search page. Manual review needed.',
            htmlLength: html.length,
          },
        });
      }
    } catch (err) {
      console.warn(`[Ediktsdatei] Failed to fetch date ${dateStr}:`,
        err instanceof Error ? err.message : err);
    }

    // Rate limiting between date queries
    if (i < daysBack - 1) {
      await sleep(1000);
    }
  }

  return results;
}

/**
 * Strategy B: Fetch the insolvency search (FIELD2=1 = Ersteintraege).
 */
async function scrapeInsolvencySearch(): Promise<ScraperResult[]> {
  const url = buildInsolvencySearchUrl(200);
  console.log(`[Ediktsdatei] Fetching insolvency search...`);

  try {
    const html = await fetchPage(url);
    const totalHits = extractTotalHits(html);
    console.log(`[Ediktsdatei] Insolvency search: ${totalHits} total hits`);

    const today = new Date().toISOString().slice(0, 10);
    const results = extractResultsFromSearchPage(html, today);
    if (results.length > 0) {
      return results;
    }

    const docLinks = extractDocumentLinks(html);
    if (docLinks.length > 0) {
      console.log(`[Ediktsdatei] Found ${docLinks.length} document links from insolvency search`);
      const fetchedResults: ScraperResult[] = [];
      const linksToFetch = docLinks.slice(0, 30);
      for (const docUrl of linksToFetch) {
        try {
          await sleep(500);
          const docHtml = await fetchPage(docUrl);
          const result = parseDocumentPage(docHtml, docUrl);
          if (result) fetchedResults.push(result);
        } catch (docErr) {
          console.warn(`[Ediktsdatei] Failed to fetch document:`,
            docErr instanceof Error ? docErr.message : docErr);
        }
      }
      return fetchedResults;
    }

    console.warn(`[Ediktsdatei] Insolvency search returned ${totalHits} hits but no extractable results`);
    return [];
  } catch (err) {
    console.warn(`[Ediktsdatei] Insolvency search failed:`,
      err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Strategy C: Try the Lotus Domino ReadViewEntries JSON API.
 */
async function scrapeDominoApi(): Promise<ScraperResult[]> {
  const jsonUrl = `${BASE_URL}/edikte/id/idedi8.nsf/suchedi?ReadViewEntries&outputformat=JSON&Count=50`;
  console.log(`[Ediktsdatei] Trying Domino JSON API...`);

  try {
    const { data } = await axios.get(jsonUrl, {
      timeout: REQUEST_TIMEOUT,
      headers: { 'User-Agent': USER_AGENT },
      // Could be JSON or XML depending on Domino version
      responseType: 'text',
    });

    const text = typeof data === 'string' ? data : JSON.stringify(data);

    // Try parsing as JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Might be XML - check for viewentries
      if (text.includes('<viewentries') || text.includes('<viewentry')) {
        console.log(`[Ediktsdatei] Domino API returned XML view entries`);
        return parseDominoXml(text);
      }
      console.warn(`[Ediktsdatei] Domino API response is neither JSON nor XML`);
      return [];
    }

    // Parse JSON view entries
    if (parsed && typeof parsed === 'object') {
      return parseDominoJson(parsed);
    }

    return [];
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // 404 or 403 is expected if this endpoint doesn't exist
    if (errMsg.includes('404') || errMsg.includes('403') || errMsg.includes('400')) {
      console.log(`[Ediktsdatei] Domino JSON API not available (${errMsg})`);
    } else {
      console.warn(`[Ediktsdatei] Domino JSON API failed: ${errMsg}`);
    }
    return [];
  }
}

/**
 * Parse Domino ReadViewEntries JSON response.
 */
function parseDominoJson(data: unknown): ScraperResult[] {
  const results: ScraperResult[] = [];

  // Domino JSON format: { "@toplevelentries": N, "viewentry": [...] }
  const obj = data as Record<string, unknown>;
  const entries = (obj.viewentry || obj.ViewEntry || []) as Record<string, unknown>[];

  if (!Array.isArray(entries)) {
    console.log(`[Ediktsdatei] Domino JSON: no viewentry array found`);
    return [];
  }

  for (const entry of entries) {
    const unid = (entry['@unid'] || entry['unid'] || '') as string;
    const columns = (entry.entrydata || entry.EntryData || []) as Record<string, unknown>[];

    let companyName = '';
    let dateStr = '';

    if (Array.isArray(columns)) {
      for (const col of columns) {
        const text = (col.text || col.Text || col.value || '') as Record<string, unknown> | string;
        const textValue = typeof text === 'object' && text !== null ? String((text as Record<string, unknown>)['0'] || '') : String(text);
        const colName = String(col['@name'] || col['@columnnumber'] || '');

        if (colName.toLowerCase().includes('firma') || colName.toLowerCase().includes('name') || colName === '0') {
          if (textValue && !companyName) companyName = textValue;
        }
        if (colName.toLowerCase().includes('datum') || colName.toLowerCase().includes('date')) {
          if (textValue) dateStr = textValue;
        }
      }
    }

    if (!companyName) continue;

    const sourceUrl = unid
      ? `${BASE_URL}/edikte/id/idedi8.nsf/0/${unid}`
      : undefined;

    results.push({
      company_name: companyName,
      proceeding_type: 'insolvenz',
      gazette_date: dateStr ? parseToIsoDate(dateStr) : new Date().toISOString().slice(0, 10),
      source_url: sourceUrl,
      source_ref: unid || undefined,
      raw_data: entry,
    });
  }

  console.log(`[Ediktsdatei] Domino JSON: parsed ${results.length} entries`);
  return results;
}

/**
 * Parse Domino ReadViewEntries XML response.
 */
function parseDominoXml(xml: string): ScraperResult[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const results: ScraperResult[] = [];

  $('viewentry').each((_i, el) => {
    const unid = $(el).attr('unid') || '';
    const columns = $(el).find('entrydata');

    let companyName = '';
    let dateStr = '';

    columns.each((_j, col) => {
      const colName = $(col).attr('name') || $(col).attr('columnnumber') || '';
      const text = $(col).find('text').text().trim() || $(col).text().trim();

      if (colName.toLowerCase().includes('firma') || colName.toLowerCase().includes('name') || colName === '0') {
        if (text && !companyName) companyName = text;
      }
      if (colName.toLowerCase().includes('datum') || colName.toLowerCase().includes('date')) {
        if (text) dateStr = text;
      }
    });

    if (!companyName) return;

    const sourceUrl = unid
      ? `${BASE_URL}/edikte/id/idedi8.nsf/0/${unid}`
      : undefined;

    results.push({
      company_name: companyName,
      proceeding_type: 'insolvenz',
      gazette_date: dateStr ? parseToIsoDate(dateStr) : new Date().toISOString().slice(0, 10),
      source_url: sourceUrl,
      source_ref: unid || undefined,
      raw_data: { unid },
    });
  });

  console.log(`[Ediktsdatei] Domino XML: parsed ${results.length} entries`);
  return results;
}

export class EdiktsdateiScraper implements ScraperAdapter {
  name = 'Ediktsdatei';
  source = 'ediktsdatei';

  async run(): Promise<ScraperResult[]> {
    console.log(`[${this.name}] Starting scrape with multiple strategies...`);

    const allResults: ScraperResult[] = [];
    const seenKeys = new Set<string>();

    function addResults(results: ScraperResult[], strategyName: string): number {
      let added = 0;
      for (const r of results) {
        // Skip placeholder/batch entries from dedup
        if (r.company_name.startsWith('[')) {
          allResults.push(r);
          added++;
          continue;
        }
        const key = `${r.company_name.toLowerCase()}|${r.gazette_date}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allResults.push(r);
          added++;
        }
      }
      console.log(`[Ediktsdatei] Strategy "${strategyName}": ${results.length} raw, ${added} new (after dedup)`);
      return added;
    }

    // Strategy A: Date-based search (most reliable)
    try {
      const dateResults = await scrapeByDate(7);
      addResults(dateResults, 'date-based search');
    } catch (err) {
      console.error(`[${this.name}] Date-based search failed:`,
        err instanceof Error ? err.message : err);
    }

    // Strategy B: Insolvency search (complementary)
    try {
      const insolvencyResults = await scrapeInsolvencySearch();
      addResults(insolvencyResults, 'insolvency search');
    } catch (err) {
      console.error(`[${this.name}] Insolvency search failed:`,
        err instanceof Error ? err.message : err);
    }

    // Strategy C: Domino API (if available - bonus)
    if (allResults.length === 0) {
      // Only try if other strategies yielded nothing
      try {
        const apiResults = await scrapeDominoApi();
        addResults(apiResults, 'Domino API');
      } catch (err) {
        console.error(`[${this.name}] Domino API failed:`,
          err instanceof Error ? err.message : err);
      }
    }

    console.log(`[${this.name}] Total unique results: ${allResults.length}`);
    return allResults;
  }
}
