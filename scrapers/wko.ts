import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://firmen.wko.at';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enrichCompany(
  companyName: string
): Promise<{ existing_website: string | null }> {
  try {
    // Step 1: Search for the company
    const searchUrl = `${BASE_URL}/SearchResult.aspx?searchterm=${encodeURIComponent(companyName)}`;

    const { data: searchHtml } = await axios.get<string>(searchUrl, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'AustrianDomainWatch/1.0',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
      },
    });

    const $search = cheerio.load(searchHtml);

    // Find the first result link to a company detail page
    const detailLink =
      $search('a.companyTitle').first().attr('href') ||
      $search('a[href*="/d/"]').first().attr('href') ||
      $search('.searchResultItem a').first().attr('href') ||
      $search('.result-item a[href]').first().attr('href');

    if (!detailLink) {
      return { existing_website: null };
    }

    const detailUrl = detailLink.startsWith('http')
      ? detailLink
      : `${BASE_URL}${detailLink.startsWith('/') ? '' : '/'}${detailLink}`;

    // Rate limit: wait before fetching detail page
    await sleep(3000);

    // Step 2: Fetch the detail page
    const { data: detailHtml } = await axios.get<string>(detailUrl, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'AustrianDomainWatch/1.0',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5',
      },
    });

    const $detail = cheerio.load(detailHtml);

    // Extract website URL — WKO detail pages show it in various selectors
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

    // Fallback: look for any external link in the contact/detail section
    if (!website) {
      $detail('a[href^="http"]').each((_i, el) => {
        if (website) return;
        const href = $detail(el).attr('href') || '';
        // Skip WKO internal links, social media, and map links
        if (
          href.includes('wko.at') ||
          href.includes('firmen.wko') ||
          href.includes('google.') ||
          href.includes('facebook.') ||
          href.includes('twitter.') ||
          href.includes('linkedin.') ||
          href.includes('instagram.') ||
          href.includes('youtube.')
        ) {
          return;
        }
        // Check if it's near a "Website" or "Homepage" label
        const parentText = $detail(el).parent().text().toLowerCase();
        if (
          parentText.includes('website') ||
          parentText.includes('homepage') ||
          parentText.includes('internet')
        ) {
          website = href;
        }
      });
    }

    return { existing_website: website };
  } catch (err) {
    console.warn(
      `[WKO] Failed to enrich company "${companyName}":`,
      err instanceof Error ? err.message : err
    );
    return { existing_website: null };
  }
}
