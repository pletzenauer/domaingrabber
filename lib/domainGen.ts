const LEGAL_SUFFIXES = [
  'stille gesellschaft',
  'ges mbh',
  'gemb h',
  'gesmbh',
  'co kg',
  'kgmbh',
  'gesnbr',
  'verein',
  'gmbh',
  'egen',
  'nfg',
  'og',
  'kg',
  'eu',
  'ag',
];

const UMLAUT_MAP: Record<string, string> = {
  'ä': 'ae',
  'ö': 'oe',
  'ü': 'ue',
  'ß': 'ss',
  'Ä': 'ae',
  'Ö': 'oe',
  'Ü': 'ue',
};

const TLDS = ['.at', '.com', '.eu', '.de', '.net', '.co.at', '.io', '.online'];

/**
 * Build a regex-safe escaped version of a suffix for matching at end of string.
 * Allows optional spaces and punctuation before the suffix.
 */
function buildSuffixPattern(): RegExp {
  const escaped = LEGAL_SUFFIXES.map((s) =>
    s.replace(/\s+/g, '\\s+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  // Match optional punctuation/spaces before the suffix, then the suffix at end of string
  return new RegExp(`[\\s.,;:\\-/&]*(?:${escaped.join('|')})\\s*$`, 'i');
}

const SUFFIX_RE = buildSuffixPattern();

/**
 * Generate a URL-safe slug from an Austrian company name.
 *
 * Steps:
 * 1. Lowercase
 * 2. Replace umlauts
 * 3. Strip legal suffixes
 * 4. Remove special characters (keep alphanumeric and spaces)
 * 5. Replace spaces with hyphens
 * 6. Trim and collapse hyphens
 */
export function generateSlug(companyName: string): string {
  let s = companyName.toLowerCase();

  // Replace umlauts
  s = s.replace(/[äöüßÄÖÜ]/g, (ch) => UMLAUT_MAP[ch] ?? ch);

  // Strip legal suffixes (may need multiple passes for compound forms)
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(SUFFIX_RE, '');
  }

  // Remove special characters, keep alphanumeric and spaces
  s = s.replace(/[^a-z0-9\s]/g, '');

  // Replace spaces with hyphens
  s = s.replace(/\s+/g, '-');

  // Trim leading/trailing hyphens and collapse multiples
  s = s.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

  return s;
}

/**
 * Generate all TLD domain variants from a slug.
 */
export function generateDomainsFromSlug(slug: string): string[] {
  if (!slug) return [];
  return TLDS.map((tld) => `${slug}${tld}`);
}

/**
 * Generate all TLD domain variants from an Austrian company name.
 */
export function generateDomains(companyName: string): string[] {
  const slug = generateSlug(companyName);
  return generateDomainsFromSlug(slug);
}
