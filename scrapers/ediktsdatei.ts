import axios from 'axios';
import * as cheerio from 'cheerio';
import type { ScraperAdapter, ScraperResult } from './index';

const RSS_URL = 'https://edikte.justiz.gv.at/edikte/rss.rss';
const SEARCH_URL =
  'https://edikte.justiz.gv.at/edikte/edikt.nsf/SearchForm?OpenForm';

function classifyProceedingType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('konkurs') || lower.includes('insolvenz')) return 'insolvenz';
  if (lower.includes('liquidat')) return 'liquidation';
  if (lower.includes('lösch') || lower.includes('loesch')) return 'loeschung';
  return 'insolvenz';
}

function extractCourt(description: string): string | undefined {
  // Common patterns: "Landesgericht Salzburg", "Bezirksgericht Innsbruck", "Handelsgericht Wien"
  const match = description.match(
    /(Landesgericht|Bezirksgericht|Handelsgericht|LG|BG|HG)\s+[\wäöüÄÖÜß\-]+/i
  );
  return match ? match[0].trim() : undefined;
}

function parseRssDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

async function fetchRssFeed(): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];

  const { data: xml } = await axios.get<string>(RSS_URL, {
    timeout: 30_000,
    headers: { 'User-Agent': 'AustrianDomainWatch/1.0' },
  });

  const $ = cheerio.load(xml, { xmlMode: true });

  $('item').each((_i, el) => {
    const title = $(el).find('title').text().trim();
    const link = $(el).find('link').text().trim();
    const description = $(el).find('description').text().trim();
    const pubDate = $(el).find('pubDate').text().trim();

    if (!title) return;

    results.push({
      company_name: title,
      court: extractCourt(description),
      proceeding_type: classifyProceedingType(`${title} ${description}`),
      gazette_date: parseRssDate(pubDate),
      source_url: link || undefined,
      source_ref: link || undefined,
      raw_data: { title, description, pubDate, link },
    });
  });

  return results;
}

async function fetchSearchPage(): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];

  try {
    // POST the search form to get insolvency edicts
    const { data: html } = await axios.get<string>(SEARCH_URL, {
      timeout: 30_000,
      headers: { 'User-Agent': 'AustrianDomainWatch/1.0' },
    });

    const $ = cheerio.load(html);

    // The result table rows typically contain: company name, court, date, type
    $('table.ediktList tr, table#SearchResults tr, div.searchResult').each(
      (_i, el) => {
        const cells = $(el).find('td');
        if (cells.length < 3) return;

        const companyName = $(cells[0]).text().trim();
        const court = $(cells[1]).text().trim();
        const dateStr = $(cells[2]).text().trim();
        const typeText = cells.length > 3 ? $(cells[3]).text().trim() : '';
        const linkEl = $(el).find('a[href]').first();
        const href = linkEl.attr('href') || '';

        if (!companyName || companyName.toLowerCase().includes('firma')) return;

        const sourceUrl = href.startsWith('http')
          ? href
          : href
            ? `https://edikte.justiz.gv.at${href}`
            : undefined;

        results.push({
          company_name: companyName,
          court: court || undefined,
          proceeding_type: classifyProceedingType(typeText || companyName),
          gazette_date: parseRssDate(dateStr),
          source_url: sourceUrl,
          raw_data: { companyName, court, dateStr, typeText },
        });
      }
    );
  } catch (err) {
    // Search page may require specific POST params or session — log and continue
    console.warn(
      'Ediktsdatei search page fetch failed, using RSS only:',
      err instanceof Error ? err.message : err
    );
  }

  return results;
}

export class EdiktsdateiScraper implements ScraperAdapter {
  name = 'Ediktsdatei';
  source = 'ediktsdatei';

  async run(): Promise<ScraperResult[]> {
    console.log(`[${this.name}] Starting scrape...`);

    const [rssResults, searchResults] = await Promise.allSettled([
      fetchRssFeed(),
      fetchSearchPage(),
    ]);

    const results: ScraperResult[] = [];

    if (rssResults.status === 'fulfilled') {
      results.push(...rssResults.value);
      console.log(`[${this.name}] RSS feed: ${rssResults.value.length} items`);
    } else {
      console.error(`[${this.name}] RSS feed failed:`, rssResults.reason);
    }

    if (searchResults.status === 'fulfilled') {
      // Deduplicate by company_name + gazette_date
      const existing = new Set(
        results.map((r) => `${r.company_name}|${r.gazette_date}`)
      );
      for (const r of searchResults.value) {
        const key = `${r.company_name}|${r.gazette_date}`;
        if (!existing.has(key)) {
          results.push(r);
          existing.add(key);
        }
      }
      console.log(
        `[${this.name}] Search page: ${searchResults.value.length} items`
      );
    }

    console.log(`[${this.name}] Total results: ${results.length}`);
    return results;
  }
}
