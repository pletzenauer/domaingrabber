import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://firmen.wko.at';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EnrichResult {
  existing_website: string | null;
  domain: string | null;
}

/**
 * Extract the registrable domain from a URL.
 * e.g. "https://www.example.co.at/page" → "example.co.at"
 */
function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    // Strip www. prefix
    hostname = hostname.replace(/^www\./, '');
    return hostname || null;
  } catch {
    return null;
  }
}

/**
 * Search WKO Firmen A-Z directory for a company and extract its website.
 */
export async function enrichCompany(
  companyName: string
): Promise<EnrichResult> {
  try {
    const searchUrl = `${BASE_URL}/SearchResult.aspx?searchterm=${encodeURIComponent(companyName)}`;

    const { data: searchHtml } = await axios.get<string>(searchUrl, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AustrianDomainWatch/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
      },
    });

    const $search = cheerio.load(searchHtml);

    // Find the first result link
    const detailLink =
      $search('a.companyTitle').first().attr('href') ||
      $search('a[href*="/d/"]').first().attr('href') ||
      $search('.searchResultItem a').first().attr('href') ||
      $search('.result-item a[href]').first().attr('href');

    if (!detailLink) {
      return { existing_website: null, domain: null };
    }

    const detailUrl = detailLink.startsWith('http')
      ? detailLink
      : `${BASE_URL}${detailLink.startsWith('/') ? '' : '/'}${detailLink}`;

    await sleep(3000);

    const { data: detailHtml } = await axios.get<string>(detailUrl, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AustrianDomainWatch/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
      },
    });

    const $detail = cheerio.load(detailHtml);

    let website: string | null = null;

    // Try common selectors for the website field
    const selectors = [
      'a[href*="http"][class*="web"]',
      'a[href*="http"][class*="url"]',
      '.website a',
      '.firmenWebsite a',
      'a[data-type="website"]',
      '.companyDetails a[href^="http"]',
      'a.webUrl',
    ];

    for (const selector of selectors) {
      const el = $detail(selector).first();
      if (el.length) {
        const href = el.attr('href');
        if (href && !href.includes('wko.at') && !href.includes('firmen.wko')) {
          website = href;
          break;
        }
      }
    }

    // Fallback: look for external links near "Website"/"Homepage" labels
    if (!website) {
      $detail('a[href^="http"]').each((_i, el) => {
        if (website) return;
        const href = $detail(el).attr('href') || '';
        if (
          href.includes('wko.at') || href.includes('firmen.wko') ||
          href.includes('google.') || href.includes('facebook.') ||
          href.includes('twitter.') || href.includes('linkedin.') ||
          href.includes('instagram.') || href.includes('youtube.')
        ) return;

        const parentText = $detail(el).parent().text().toLowerCase();
        if (parentText.includes('website') || parentText.includes('homepage') || parentText.includes('internet')) {
          website = href;
        }
      });
    }

    const domain = website ? extractDomain(website) : null;

    return { existing_website: website, domain };
  } catch (err) {
    console.warn(`[WKO] Failed to enrich "${companyName}":`, err instanceof Error ? err.message : err);
    return { existing_website: null, domain: null };
  }
}

/**
 * Try to find a company's domain via web search using DuckDuckGo HTML.
 * Fallback when WKO doesn't have the company's website.
 */
export async function searchCompanyDomain(companyName: string): Promise<string | null> {
  try {
    const searchQuery = `${companyName} Austria website`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

    const { data: html } = await axios.get<string>(url, {
      timeout: 10_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
    });

    const $ = cheerio.load(html);

    // Look at the first few search result URLs
    const results: string[] = [];
    $('a.result__url, a.result__a').each((_i, el) => {
      const href = $(el).attr('href') || '';
      if (href.startsWith('http')) {
        const domain = extractDomain(href);
        if (domain && !isGenericDomain(domain)) {
          results.push(domain);
        }
      }
    });

    // Return the most likely company domain (first non-generic result)
    return results[0] || null;
  } catch {
    return null;
  }
}

/**
 * Check if a domain is a generic/platform domain (not a company domain).
 */
function isGenericDomain(domain: string): boolean {
  const generic = [
    'wko.at', 'firmen.wko.at', 'firmenabc.at', 'herold.at',
    'google.com', 'google.at', 'facebook.com', 'instagram.com',
    'linkedin.com', 'twitter.com', 'youtube.com', 'tiktok.com',
    'wikipedia.org', 'yelp.com', 'tripadvisor.com', 'tripadvisor.at',
    'kununu.com', 'xing.com', 'firmenwissen.de',
    'companyhouse.at', 'cylex.at', 'duckduckgo.com',
    'gelbeseiten.at', 'telefonabc.at',
  ];
  return generic.some((g) => domain === g || domain.endsWith('.' + g));
}
