import axios from 'axios';
import whoiser from 'whoiser';
import { addDays, isBefore } from 'date-fns';

export interface DomainCheckResult {
  status: 'available' | 'registered' | 'expiring' | 'redemption' | 'error';
  expiry_date: string | null;
  registrar: string | null;
  whois_raw: string | null;
  rdap_raw: string | null;
}

// Rate limiting: track last request timestamp per TLD
const lastRequestTime: Record<string, number> = {};
const MIN_GAP_MS = 1100; // slightly over 1 second

async function rateLimit(tld: string): Promise<void> {
  const now = Date.now();
  const last = lastRequestTime[tld] ?? 0;
  const elapsed = now - last;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - elapsed));
  }
  lastRequestTime[tld] = Date.now();
}

function extractTld(domain: string): string {
  // Handle compound TLDs like .co.at
  const parts = domain.split('.');
  if (parts.length >= 3 && parts[parts.length - 2] === 'co') {
    return `.${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }
  return `.${parts[parts.length - 1]}`;
}

/**
 * Check a .at domain using nic.at RDAP.
 */
async function checkRDAP(domain: string): Promise<DomainCheckResult> {
  try {
    const resp = await axios.get(`https://rdap.nic.at/domain/${domain}`, {
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });

    if (resp.status === 404) {
      return {
        status: 'available',
        expiry_date: null,
        registrar: null,
        whois_raw: null,
        rdap_raw: JSON.stringify(resp.data),
      };
    }

    const data = resp.data;
    const rdapRaw = JSON.stringify(data);

    // Extract status array
    const statusArr: string[] = data.status ?? [];

    // Check for inactive / removed
    if (statusArr.some((s: string) => /inactive|removed/i.test(s))) {
      return {
        status: 'available',
        expiry_date: null,
        registrar: extractRegistrarFromRDAP(data),
        whois_raw: null,
        rdap_raw: rdapRaw,
      };
    }

    // Check for redemption period
    if (statusArr.some((s: string) => /redemptionPeriod|pendingDelete/i.test(s))) {
      return {
        status: 'redemption',
        expiry_date: extractExpiryFromRDAP(data),
        registrar: extractRegistrarFromRDAP(data),
        whois_raw: null,
        rdap_raw: rdapRaw,
      };
    }

    const expiryDate = extractExpiryFromRDAP(data);

    // Check if expiring within 30 days
    if (expiryDate) {
      const expiry = new Date(expiryDate);
      const thirtyDaysFromNow = addDays(new Date(), 30);
      if (isBefore(expiry, thirtyDaysFromNow)) {
        return {
          status: 'expiring',
          expiry_date: expiryDate,
          registrar: extractRegistrarFromRDAP(data),
          whois_raw: null,
          rdap_raw: rdapRaw,
        };
      }
    }

    return {
      status: 'registered',
      expiry_date: expiryDate,
      registrar: extractRegistrarFromRDAP(data),
      whois_raw: null,
      rdap_raw: rdapRaw,
    };
  } catch (err) {
    // Network error or timeout likely means domain doesn't exist in RDAP
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return {
        status: 'available',
        expiry_date: null,
        registrar: null,
        whois_raw: null,
        rdap_raw: null,
      };
    }
    return {
      status: 'error',
      expiry_date: null,
      registrar: null,
      whois_raw: null,
      rdap_raw: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractExpiryFromRDAP(data: Record<string, unknown>): string | null {
  const events = data.events as Array<{ eventAction: string; eventDate: string }> | undefined;
  if (!events) return null;
  const expiry = events.find((e) => e.eventAction === 'expiration');
  return expiry?.eventDate ?? null;
}

function extractRegistrarFromRDAP(data: Record<string, unknown>): string | null {
  const entities = data.entities as Array<{
    roles?: string[];
    vcardArray?: unknown[];
    handle?: string;
  }> | undefined;
  if (!entities) return null;
  const registrar = entities.find((e) => e.roles?.includes('registrar'));
  if (!registrar) return null;

  // Try to extract name from vcard
  if (registrar.vcardArray && Array.isArray(registrar.vcardArray[1])) {
    const props = registrar.vcardArray[1] as Array<[string, unknown, string, string]>;
    const fn = props.find((p) => p[0] === 'fn');
    if (fn) return fn[3];
  }
  return registrar.handle ?? null;
}

/**
 * Check a non-.at domain using whoiser.
 */
async function checkWHOIS(domain: string): Promise<DomainCheckResult> {
  try {
    const result = await whoiser(domain, { timeout: 15000 });

    // whoiser returns an object keyed by WHOIS server
    const servers = Object.keys(result);
    if (servers.length === 0) {
      return {
        status: 'available',
        expiry_date: null,
        registrar: null,
        whois_raw: null,
        rdap_raw: null,
      };
    }

    const whoisData = result[servers[0]] as Record<string, unknown>;
    const rawText = JSON.stringify(whoisData);

    // Check for "No match" patterns that indicate availability
    const textValues = Object.values(whoisData).join(' ');
    if (/no match|not found|no data found|no entries found|available/i.test(textValues)) {
      return {
        status: 'available',
        expiry_date: null,
        registrar: null,
        whois_raw: rawText,
        rdap_raw: null,
      };
    }

    // Extract status
    const domainStatus = whoisData['Domain Status'] ?? whoisData['Status'] ?? '';
    const statusStr = Array.isArray(domainStatus)
      ? domainStatus.join(' ')
      : String(domainStatus);

    // Check for redemption
    if (/redemptionPeriod|pendingDelete/i.test(statusStr)) {
      return {
        status: 'redemption',
        expiry_date: extractExpiryFromWHOIS(whoisData),
        registrar: extractRegistrarFromWHOIS(whoisData),
        whois_raw: rawText,
        rdap_raw: null,
      };
    }

    const expiryDate = extractExpiryFromWHOIS(whoisData);

    // Check if expiring within 30 days
    if (expiryDate) {
      const expiry = new Date(expiryDate);
      const thirtyDaysFromNow = addDays(new Date(), 30);
      if (isBefore(expiry, thirtyDaysFromNow)) {
        return {
          status: 'expiring',
          expiry_date: expiryDate,
          registrar: extractRegistrarFromWHOIS(whoisData),
          whois_raw: rawText,
          rdap_raw: null,
        };
      }
    }

    return {
      status: 'registered',
      expiry_date: expiryDate,
      registrar: extractRegistrarFromWHOIS(whoisData),
      whois_raw: rawText,
      rdap_raw: null,
    };
  } catch (err) {
    return {
      status: 'error',
      expiry_date: null,
      registrar: null,
      whois_raw: err instanceof Error ? err.message : String(err),
      rdap_raw: null,
    };
  }
}

function extractExpiryFromWHOIS(data: Record<string, unknown>): string | null {
  const keys = [
    'Expiry Date',
    'Registry Expiry Date',
    'Registrar Registration Expiration Date',
    'paid-till',
    'Expiration Date',
  ];
  for (const key of keys) {
    if (data[key]) {
      const val = String(data[key]);
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  return null;
}

function extractRegistrarFromWHOIS(data: Record<string, unknown>): string | null {
  const keys = ['Registrar', 'Registrar Name', 'registrar'];
  for (const key of keys) {
    if (data[key]) return String(data[key]);
  }
  return null;
}

/**
 * Check a domain's registration status.
 * Uses RDAP for .at domains, WHOIS for everything else.
 * Enforces rate limiting per TLD.
 */
export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  const tld = extractTld(domain);
  await rateLimit(tld);

  if (tld === '.at' || tld === '.co.at') {
    return checkRDAP(domain);
  }
  return checkWHOIS(domain);
}
