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
    'google.com', 'google.at', 'duckduckgo.com', 'bing.com',
    'wikipedia.org', 'reddit.com', 'amazon.com', 'amazon.de',
    // Austrian government / legal
    'justiz.gv.at', 'ris.bka.gv.at', 'usp.gv.at', 'wienerborse.at',
    'ediktsdatei.justiz.gv.at', 'data.gv.at',
    // News / media
    'derstandard.at', 'diepresse.com', 'orf.at', 'krone.at',
  ];
  return generic.some((g) => domain === g || domain.endsWith('.' + g));
}

/**
 * Strip legal suffixes and noise from company name for better search results.
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
 * Primary: Find company domain via Brave Search API.
 * Free tier: 2,000 queries/month. Reliable, no CAPTCHA.
 */
export async function searchCompanyDomain(companyName: string): Promise<string | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.warn('[Search] BRAVE_SEARCH_API_KEY not set, skipping web search');
    return null;
  }

  try {
    const cleanName = cleanCompanyNameForSearch(companyName);
    if (!cleanName || cleanName.length < 2) return null;

    const searchQuery = `${cleanName} Austria`;

    const { data } = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: {
        q: searchQuery,
        count: 5,
        country: 'AT',
      },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      timeout: 10_000,
    });

    const results = data?.web?.results;
    if (!results || !Array.isArray(results)) return null;

    for (const result of results) {
      const url = result.url;
      if (!url) continue;

      const domain = extractDomain(url);
      if (domain && !isGenericDomain(domain)) {
        return domain;
      }
    }

    return null;
  } catch (err) {
    console.warn(`[Search] Brave search failed for "${companyName}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fallback: Search WKO Firmen A-Z directory.
 * Less reliable but can provide the official registered website.
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
