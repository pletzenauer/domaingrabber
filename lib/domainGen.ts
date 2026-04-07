/**
 * Austrian company name → domain generation.
 *
 * The goal is to extract the "brand" part of a company name — the short,
 * memorable name someone would actually register as a domain — and generate
 * realistic TLD variants.
 *
 * Examples:
 *   "Davide GmbH" → davide.at, davide.com, ...
 *   '"Cafe Lehner" Betriebs GmbH' → cafe-lehner.at, ...
 *   "SEFIDANOSKI Nihad, Inhaber der KREATIV Fassadenbau e.U." → kreativ-fassadenbau.at, ...
 *   "Nothegger Transport Logistik GmbH" → nothegger-transport.at, nothegger.at, ...
 *   "Filmforum am Bahnhof" Errichtungs- und Betriebsgesellschaft m.b.H. → filmforum-am-bahnhof.at, ...
 */

const UMLAUT_MAP: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
  'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue',
};

const TLDS = ['.at', '.com', '.co.at', '.eu', '.de'];

/**
 * Legal suffixes and descriptive noise to strip from company names.
 * Order matters — longer/more specific patterns first.
 */
const LEGAL_FORMS = [
  // Long compound forms
  'errichtungs- und betriebsgesellschaft m.b.h.',
  'errichtungs- und betriebsgesellschaft mbh',
  'errichtungs und betriebsgesellschaft',
  'gesellschaft m.b.h.',
  'gesellschaft mbh',
  'ges.m.b.h.',
  'ges.mbh.',
  'gesmbh',
  'ges mbh',
  '& co. kg',
  '& co kg',
  '& co. og',
  '& co og',
  'stille gesellschaft',
  // Standard forms
  'gmbh & co kg',
  'gmbh & co. kg',
  'gmbh',
  'm.b.h.',
  'mbh',
  'e.u.',
  'eu.',
  'co kg',
  'cokg',
  'nfg',
  'ohg',
  'og',
  'kg',
  'ag',
  'se',
  'reg.gen.m.b.h.',
  'gen.m.b.h.',
  'genossenschaft',
  'stiftung',
  'verein',
  'privatstiftung',
];

/**
 * Descriptive words to strip (often appear between brand name and legal form).
 */
const DESCRIPTIVE_NOISE = [
  'betriebs',
  'betriebsgesellschaft',
  'errichtungs',
  'verwaltungs',
  'verwaltungsgesellschaft',
  'handels',
  'handelsgesellschaft',
  'produktions',
  'produktionsgesellschaft',
  'veranstaltungs',
  'beteiligungs',
  'beteiligung',
  'projektentwicklungs',
  'immobilienprojekt',
];

/**
 * Extract the "brand name" from an Austrian company name.
 * This is the part that someone would realistically register as a domain.
 */
function extractBrandName(companyName: string): string[] {
  let name = companyName.trim();

  // Strategy 1: If name has a quoted part, use that as the brand
  // e.g. "Cafe Lehner" Betriebs GmbH → Cafe Lehner
  const quotedMatch = name.match(/[„""«»'‚']([^"„""«»'‚']+)[„""«»'‚']/);
  if (quotedMatch) {
    const quoted = quotedMatch[1].trim();
    if (quoted.length >= 2) {
      return [quoted];
    }
  }

  // Also handle regular double quotes
  const dblQuoteMatch = name.match(/"([^"]+)"/);
  if (dblQuoteMatch) {
    const quoted = dblQuoteMatch[1].trim();
    if (quoted.length >= 2) {
      return [quoted];
    }
  }

  // Strategy 2: "Inhaber der BRAND e.U." or "Inhaber des BRAND" pattern
  // e.g. "SEFIDANOSKI Nihad, Inhaber der KREATIV Fassadenbau e.U." → KREATIV Fassadenbau
  const inhaberMatch = name.match(/Inhaber(?:in)?\s+(?:der|des|von)\s+(.+)/i);
  if (inhaberMatch) {
    name = inhaberMatch[1].trim();
  }

  // Strategy 3: "Name, Inhaber der BRAND" — take what's after "Inhaber der"
  // Already handled above

  // Strip legal forms (case-insensitive, from end of string)
  let cleaned = name.toLowerCase();
  for (const form of LEGAL_FORMS) {
    // Match the legal form at the end, possibly preceded by spaces/punctuation
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const re = new RegExp(`[\\s.,;:&\\-/]*${escaped}[\\s.]*$`, 'i');
    cleaned = cleaned.replace(re, '').trim();
  }

  // Strip descriptive noise words (only at the end, to preserve brand)
  for (const noise of DESCRIPTIVE_NOISE) {
    const re = new RegExp(`[\\s\\-]+${noise}\\s*$`, 'i');
    cleaned = cleaned.replace(re, '').trim();
  }

  // Strip trailing punctuation and conjunctions
  cleaned = cleaned.replace(/[\s\-&,;:]+$/, '').trim();
  cleaned = cleaned.replace(/\s+und\s*$/i, '').trim();
  cleaned = cleaned.replace(/\s+and\s*$/i, '').trim();

  if (!cleaned || cleaned.length < 2) return [];

  // Generate variants:
  // 1. Full brand name (with spaces → hyphens)
  // 2. If multi-word, also just the first word (if it's substantial enough)
  const brands: string[] = [cleaned];

  const words = cleaned.split(/\s+/);
  if (words.length >= 2 && words[0].length >= 3) {
    // Also generate a shorter variant with just the first 1-2 words
    brands.push(words.slice(0, 2).join(' '));
    if (words.length >= 3) {
      brands.push(words[0]);
    }
  }

  return [...new Set(brands)];
}

/**
 * Generate a URL-safe slug from a brand name.
 */
export function generateSlug(name: string): string {
  let s = name.toLowerCase().trim();

  // Replace umlauts
  s = s.replace(/[äöüßÄÖÜ]/g, (ch) => UMLAUT_MAP[ch] ?? ch);

  // Remove special characters, keep alphanumeric, spaces, and hyphens
  s = s.replace(/[^a-z0-9\s\-]/g, '');

  // Replace spaces with hyphens
  s = s.replace(/\s+/g, '-');

  // Collapse and trim hyphens
  s = s.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

  return s;
}

/**
 * Generate domain variants from an Austrian company name.
 * Returns realistic domains that someone might actually register.
 */
export function generateDomains(companyName: string): string[] {
  const brands = extractBrandName(companyName);
  if (brands.length === 0) return [];

  const domains = new Set<string>();

  for (const brand of brands) {
    const slug = generateSlug(brand);
    if (!slug || slug.length < 2 || slug.length > 63) continue;

    for (const tld of TLDS) {
      domains.add(`${slug}${tld}`);
    }
  }

  return [...domains];
}

/**
 * Check if a name looks like a company (vs natural person).
 */
export function isCompanyName(name: string): boolean {
  // Check for legal form indicators
  const companyIndicators = /\b(gmbh|m\.?b\.?h|e\.?\s?u\.?|kg|og|ag|ohg|se|gen\.?m\.?b\.?h|stiftung|verein|genossenschaft)\b|& co/i;
  if (companyIndicators.test(name)) return true;

  // Check for quoted brand names (typical for businesses)
  if (/["„""«»']/.test(name)) return true;

  // Check for "Inhaber" pattern (sole proprietor)
  if (/inhaber/i.test(name)) return true;

  // Natural person pattern: "Lastname, Firstname" or "LASTNAME, Firstname"
  if (/^[A-ZÄÖÜ][a-zäöüß]+,\s+[A-ZÄÖÜ]/.test(name)) return false;
  if (/^[A-ZÄÖÜ]{2,},\s+[A-ZÄÖÜ]/.test(name)) return false;

  return false;
}

/**
 * Generate domains from slug (for backwards compatibility).
 */
export function generateDomainsFromSlug(slug: string): string[] {
  if (!slug) return [];
  return TLDS.map((tld) => `${slug}${tld}`);
}
