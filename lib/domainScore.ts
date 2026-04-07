import dns from "dns";
import { promisify } from "util";

const resolveMx = promisify(dns.resolveMx);
const resolveNs = promisify(dns.resolveNs);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainScore {
  domain: string;
  backlink_count: number;
  referring_domains: number;
  domain_authority: number;
  organic_keywords: number;
  page_rank: number;
  seo_score: number;
  score_raw: {
    backlink_points: number;
    page_rank_points: number;
    domain_history_points: number;
    domain_authority_points: number;
    active_dns_points: number;
  };
  scored_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch with a 5-second timeout */
async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Data-source fetchers
// ---------------------------------------------------------------------------

/**
 * OpenPageRank API — returns page_rank_decimal (0-10) or null on failure.
 * Requires OPENPAGERANK_API_KEY env var; skipped if not set.
 */
async function fetchPageRank(domain: string): Promise<number | null> {
  const apiKey = process.env.OPENPAGERANK_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const url = `https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`;
    const res = await fetchWithTimeout(url, {
      headers: { "API-OPR": apiKey },
    });
    if (!res.ok) {
      console.error(`[domainScore] OpenPageRank HTTP ${res.status} for ${domain}`);
      return null;
    }
    const data = await res.json();
    const entry = data?.response?.[0];
    if (entry && typeof entry.page_rank_decimal === "number") {
      return entry.page_rank_decimal;
    }
    return null;
  } catch (err) {
    console.error(`[domainScore] OpenPageRank error for ${domain}:`, err);
    return null;
  }
}

/**
 * CommonCrawl — returns estimated page/backlink count or 0 on failure.
 */
async function fetchCommonCrawlPages(domain: string): Promise<number> {
  try {
    const url =
      `https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.${encodeURIComponent(domain)}&output=json&limit=1&showNumPages=true`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      console.error(`[domainScore] CommonCrawl HTTP ${res.status} for ${domain}`);
      return 0;
    }
    const text = await res.text();
    if (!text.trim()) return 0;

    // Response can be newline-delimited JSON; take first line
    const firstLine = text.trim().split("\n")[0];
    const parsed = JSON.parse(firstLine);
    const pages = Number(parsed.pages ?? parsed.blocks ?? 0);
    return isNaN(pages) ? 0 : pages;
  } catch (err) {
    console.error(`[domainScore] CommonCrawl error for ${domain}:`, err);
    return 0;
  }
}

/**
 * Wayback Machine CDX API — returns true if the domain has at least one snapshot.
 */
async function fetchWaybackExists(domain: string): Promise<boolean> {
  try {
    const url =
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&limit=1&fl=timestamp`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      console.error(`[domainScore] Wayback HTTP ${res.status} for ${domain}`);
      return false;
    }
    const text = await res.text();
    if (!text.trim()) return false;
    const data = JSON.parse(text);
    // CDX returns an array of arrays; first row is header, data rows follow
    return Array.isArray(data) && data.length > 1;
  } catch (err) {
    console.error(`[domainScore] Wayback error for ${domain}:`, err);
    return false;
  }
}

/**
 * DNS check — returns true if domain has active MX or NS records.
 */
async function checkActiveDns(domain: string): Promise<boolean> {
  try {
    const [mx, ns] = await Promise.allSettled([
      resolveMx(domain),
      resolveNs(domain),
    ]);
    const hasMx = mx.status === "fulfilled" && mx.value.length > 0;
    const hasNs = ns.status === "fulfilled" && ns.value.length > 0;
    return hasMx || hasNs;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function backlinkPoints(count: number): number {
  if (count >= 1000) return 30;
  if (count >= 101) return 25;
  if (count >= 11) return 15;
  if (count >= 1) return 5;
  return 0;
}

function pageRankPoints(pr: number | null): number {
  if (pr === null || pr <= 0) return 0;
  // Scale 0-10 -> 0-25
  return Math.min(25, (pr / 10) * 25);
}

function domainHistoryPoints(hasSnapshots: boolean): number {
  return hasSnapshots ? 20 : 0;
}

function domainAuthorityPoints(pr: number | null, backlinkCount: number): number {
  // Derived metric: combine normalised page rank (0-1) and backlink tier (0-1)
  const prNorm = pr !== null && pr > 0 ? Math.min(pr / 10, 1) : 0;
  const blNorm =
    backlinkCount >= 1000
      ? 1
      : backlinkCount >= 101
        ? 0.75
        : backlinkCount >= 11
          ? 0.5
          : backlinkCount >= 1
            ? 0.25
            : 0;
  // 15% weight -> max 15 pts
  return Math.round(((prNorm + blNorm) / 2) * 15);
}

function activeDnsPoints(isActive: boolean): number {
  // No records = 10 (expired = good for grabbing), active = 0
  return isActive ? 0 : 10;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score a single domain across all free data sources.
 * Runs checks in parallel where possible, with graceful degradation.
 */
export async function scoreDomain(domain: string): Promise<DomainScore> {
  const [pageRank, backlinkCount, hasHistory, hasDns] = await Promise.all([
    fetchPageRank(domain),
    fetchCommonCrawlPages(domain),
    fetchWaybackExists(domain),
    checkActiveDns(domain),
  ]);

  const bp = backlinkPoints(backlinkCount);
  const prp = pageRankPoints(pageRank);
  const dhp = domainHistoryPoints(hasHistory);
  const dap = domainAuthorityPoints(pageRank, backlinkCount);
  const adp = activeDnsPoints(hasDns);

  const seoScore = bp + prp + dhp + dap + adp;

  // Domain authority as a 0-100 scale for the output field
  const daFull = Math.round(((pageRank ?? 0) / 10) * 50 + Math.min(backlinkCount / 1000, 1) * 50);

  return {
    domain,
    backlink_count: backlinkCount,
    referring_domains: 0, // not available from free sources
    domain_authority: daFull,
    organic_keywords: 0, // not available from free sources
    page_rank: pageRank ?? 0,
    seo_score: Math.min(100, Math.max(0, seoScore)),
    score_raw: {
      backlink_points: bp,
      page_rank_points: prp,
      domain_history_points: dhp,
      domain_authority_points: dap,
      active_dns_points: adp,
    },
    scored_at: new Date().toISOString(),
  };
}

/**
 * Score multiple domains with rate limiting (1 request batch per second).
 */
export async function scoreDomainBatch(
  domains: string[],
): Promise<DomainScore[]> {
  const results: DomainScore[] = [];

  for (let i = 0; i < domains.length; i++) {
    const score = await scoreDomain(domains[i]);
    results.push(score);

    // Rate limit: wait 1 second between domains (skip after last)
    if (i < domains.length - 1) {
      await sleep(1000);
    }
  }

  return results;
}
