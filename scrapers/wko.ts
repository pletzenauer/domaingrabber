import axios from 'axios';
import * as cheerio from 'cheerio';

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
    hostname = hostname.replace(/^www\./, '');
    return hostname || null;
  } catch {
    return null;
  }
}

/**
 * Extract actual URL from DuckDuckGo redirect link.
 * DDG links look like: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
 */
function extractDDGUrl(href: string): string | null {
  try {
    // Normalize protocol-relative URLs
    const fullUrl = href.startsWith('//') ? `https:${href}` : href;
    const parsed = new URL(fullUrl);
    const uddg = parsed.searchParams.get('uddg');
    return uddg || null;
  } catch {
    return null;
  }
}

/**
 * Check if a domain is a generic/platform domain (not a company domain).
 */
function isGenericDomain(domain: string): boolean {
  const generic = [
    // Directories & listings
    'wko.at', 'firmen.wko.at', 'firmenabc.at', 'herold.at',
    'companyhouse.at', 'cylex.at', 'gelbeseiten.at', 'telefonabc.at',
    'firmenwissen.de', 'firmenbuchgrundbuch.at', 'bonitaet.at',
    'northdata.com', 'dnb.com', 'kompass.com',
    'techpilot.com', 'europages.com', 'advantageaustria.org',
    // Social media
    'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com',
    'youtube.com', 'tiktok.com', 'xing.com', 'kununu.com',
    // Review/travel
    'yelp.com', 'tripadvisor.com', 'tripadvisor.at',
    'booking.com', 'falstaff.at',
    // Search engines & general
    'google.com', 'google.at', 'duckduckgo.com',
    'wikipedia.org', 'reddit.com',
    // Austrian government / legal
    'justiz.gv.at', 'ris.bka.gv.at', 'usp.gv.at', 'wienerborse.at',
    'ediktsdatei.justiz.gv.at',
  ];
  return generic.some((g) => domain === g || domain.endsWith('.' + g));
}

/**
 * Strip the brand/company name to a cleaner search query.
 * Removes legal suffixes for better search results.
 */
function cleanCompanyNameForSearch(name: string): string {
  let cleaned = name.trim();
  // Remove quoted parts' quotes but keep content
  cleaned = cleaned.replace(/[„""«»'"]/g, '');
  // Remove common legal forms
  cleaned = cleaned.replace(/\b(gmbh|m\.?b\.?h\.?|e\.?\s?u\.?|kg|og|ag|ohg|se|co\.?\s?kg|ges\.?m\.?b\.?h\.?|betriebs|betriebsgesellschaft|errichtungs-?\s?und\s?betriebsgesellschaft|verwaltungs|handels|inhaber(?:in)?:?\s+\w+\s+\w+)\b/gi, '');
  // Remove trailing & and punctuation
  cleaned = cleaned.replace(/[&,;:\-.\s]+$/, '').trim();
  return cleaned;
}

/**
 * Primary: Find company domain via DuckDuckGo HTML search.
 * Parses DDG redirect URLs to extract actual target domains.
 */
export async function searchCompanyDomain(companyName: string): Promise<string | null> {
  try {
    const cleanName = cleanCompanyNameForSearch(companyName);
    if (!cleanName || cleanName.length < 2) return null;

    const searchQuery = `${cleanName} Austria`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

    const { data: html } = await axios.get<string>(url, {
      timeout: 10_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
      },
    });

    const $ = cheerio.load(html);

    const results: string[] = [];

    // DDG uses redirect links: //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
    $('a.result__a').each((_i, el) => {
      if (results.length >= 5) return; // only check first 5
      const href = $(el).attr('href') || '';
      const actualUrl = extractDDGUrl(href);
      if (!actualUrl) return;

      const domain = extractDomain(actualUrl);
      if (domain && !isGenericDomain(domain) && !results.includes(domain)) {
        results.push(domain);
      }
    });

    // Also try result__url links as backup
    if (results.length === 0) {
      $('a.result__url').each((_i, el) => {
        if (results.length >= 5) return;
        const href = $(el).attr('href') || '';
        const actualUrl = extractDDGUrl(href);
        if (!actualUrl) return;

        const domain = extractDomain(actualUrl);
        if (domain && !isGenericDomain(domain) && !results.includes(domain)) {
          results.push(domain);
        }
      });
    }

    return results[0] || null;
  } catch (err) {
    console.warn(`[DDG] Search failed for "${companyName}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Secondary/fallback: Search WKO Firmen A-Z directory.
 * Less reliable than DDG but can provide the official registered website.
 */
export async function enrichCompany(
  companyName: string
): Promise<EnrichResult> {
  try {
    const searchUrl = `https://firmen.wko.at/SearchResult.aspx?searchterm=${encodeURIComponent(companyName)}`;

    const { data: searchHtml } = await axios.get<string>(searchUrl, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
      },
    });

    const $search = cheerio.load(searchHtml);

    const detailLink =
      $search('a.companyTitle').first().attr('href') ||
      $search('a[href*="/d/"]').first().attr('href') ||
      $search('.searchResultItem a').first().attr('href') ||
      $search('.result-item a[href]').first().attr('href');

    if (!detailLink) {
      return { existing_website: null, domain: null };
    }

    const BASE_URL = 'https://firmen.wko.at';
    const detailUrl = detailLink.startsWith('http')
      ? detailLink
      : `${BASE_URL}${detailLink.startsWith('/') ? '' : '/'}${detailLink}`;

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const { data: detailHtml } = await axios.get<string>(detailUrl, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
      },
    });

    const $detail = cheerio.load(detailHtml);

    let website: string | null = null;

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

    if (!website) {
      $detail('a[href^="http"]').each((_i, el) => {
        if (website) return;
        const href = $detail(el).attr('href') || '';
        if (isGenericDomain(extractDomain(href) || '')) return;
        if (href.includes('wko.at') || href.includes('firmen.wko')) return;

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
