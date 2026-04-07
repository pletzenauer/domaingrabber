import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { query } from '../lib/db';
import { generateDomains, generateSlug, isCompanyName } from '../lib/domainGen';
import { checkDomain, checkDomainOnline } from '../lib/whois';
import { sendBatchAlert } from '../lib/telegram';
import { sendNtfyBatchAlert } from '../lib/ntfy';
import { EdiktsdateiScraper } from '../scrapers/ediktsdatei';
import { GisaScraper } from '../scrapers/gisa';
import { enrichCompany, searchCompanyDomain } from '../scrapers/wko';
import { setupScheduler } from '../lib/queue';
import { scoreDomainBatch } from '../lib/domainScore';

// ─── Redis connection for workers ────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const WHOIS_BATCH_SIZE = parseInt(process.env.WHOIS_BATCH_SIZE ?? '20', 10);
const WHOIS_INTERVAL_HOURS = parseInt(process.env.WHOIS_INTERVAL_HOURS ?? '24', 10);

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('error', (err) => {
  console.error('[Worker] Redis connection error:', err.message);
});

// ─── Helper: run a scraper and persist results ───────────────────────────────

async function runScraperJob(
  source: string,
  scraperRun: () => Promise<
    Array<{
      company_name: string;
      court?: string;
      proceeding_type: string;
      gazette_date: string;
      source_url?: string;
      source_ref?: string;
      raw_data?: Record<string, unknown>;
    }>
  >
): Promise<void> {
  // 1. Create scraper_runs record
  const runResult = await query(
    `INSERT INTO scraper_runs (source, status, started_at) VALUES ($1, 'running', NOW()) RETURNING id`,
    [source]
  );
  const runId = runResult.rows[0].id;

  try {
    // 2. Run scraper
    const results = await scraperRun();
    let newCount = 0;

    for (const r of results) {
      // 3. Insert into dissolutions (skip duplicates by source_ref)
      if (r.source_ref) {
        const existing = await query(
          `SELECT id FROM dissolutions WHERE source = $1 AND source_ref = $2 LIMIT 1`,
          [source, r.source_ref]
        );
        if (existing.rowCount && existing.rowCount > 0) continue; // duplicate
      }

      const insertResult = await query(
        `INSERT INTO dissolutions (company_name, company_slug, court, proceeding_type, gazette_date, source, source_url, source_ref, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          r.company_name,
          generateSlug(r.company_name),
          r.court ?? null,
          r.proceeding_type,
          r.gazette_date,
          source,
          r.source_url ?? null,
          r.source_ref ?? null,
          r.raw_data ? JSON.stringify(r.raw_data) : null,
        ]
      );

      const dissolutionId = insertResult.rows[0].id;
      newCount++;

      // 4. Only generate domains for companies (not natural persons)
      const companyFlag = r.raw_data?.is_company ?? isCompanyName(r.company_name);
      if (companyFlag) {
        // Generate domain variants from the brand name
        const domains = generateDomains(r.company_name);
        for (const domain of domains) {
          const tld = domain.substring(domain.indexOf('.'));
          await query(
            `INSERT INTO domains (dissolution_id, domain, tld)
             VALUES ($1, $2, $3)
             ON CONFLICT (domain) DO NOTHING`,
            [dissolutionId, domain, tld]
          );
        }

        // Queue WKO enrichment to find the actual company website/domain
        const { enrichWKOQueue } = await import('../lib/queue');
        await enrichWKOQueue.add('enrich', { dissolution_id: dissolutionId });
      }
    }

    // 7. Update scraper_runs
    await query(
      `UPDATE scraper_runs SET status = 'done', records_new = $1, finished_at = NOW() WHERE id = $2`,
      [newCount, runId]
    );

    console.log(`[${source}] Scraper run #${runId} completed: ${newCount} new records out of ${results.length} total`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE scraper_runs SET status = 'error', error_msg = $1, finished_at = NOW() WHERE id = $2`,
      [message.slice(0, 2000), runId]
    );
    throw err;
  }
}

// ─── Worker: scrapeEdiktsdatei ───────────────────────────────────────────────

const ediktsdateiWorker = new Worker(
  'scrapeEdiktsdatei',
  async (_job: Job) => {
    const scraper = new EdiktsdateiScraper();
    await runScraperJob('ediktsdatei', () => scraper.run());
  },
  {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 60_000 },
  }
);

ediktsdateiWorker.on('completed', (job) => {
  console.log(`[ediktsdatei] Job ${job.id} completed`);
});
ediktsdateiWorker.on('failed', (job, err) => {
  console.error(`[ediktsdatei] Job ${job?.id} failed:`, err.message);
});

// ─── Worker: scrapeGISA ──────────────────────────────────────────────────────

const gisaWorker = new Worker(
  'scrapeGISA',
  async (_job: Job) => {
    const scraper = new GisaScraper();
    await runScraperJob('gisa', () => scraper.run());
  },
  {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 60_000 },
  }
);

gisaWorker.on('completed', (job) => {
  console.log(`[gisa] Job ${job.id} completed`);
});
gisaWorker.on('failed', (job, err) => {
  console.error(`[gisa] Job ${job?.id} failed:`, err.message);
});

// ─── Worker: enrichWKO ───────────────────────────────────────────────────────

const enrichWorker = new Worker(
  'enrichWKO',
  async (job: Job<{ dissolution_id: number }>) => {
    const { dissolution_id } = job.data;

    const result = await query(
      `SELECT company_name FROM dissolutions WHERE id = $1`,
      [dissolution_id]
    );
    if (result.rowCount === 0) {
      console.warn(`[enrichWKO] Dissolution #${dissolution_id} not found, skipping`);
      return;
    }

    const companyName = result.rows[0].company_name;

    // 1. Try WKO directory
    const enrichment = await enrichCompany(companyName);

    // 2. If WKO didn't find a domain, try web search
    let domain = enrichment.domain;
    if (!domain) {
      domain = await searchCompanyDomain(companyName);
    }

    // 3. Update dissolutions with website
    await query(
      `UPDATE dissolutions SET existing_website = $1, enriched_at = NOW() WHERE id = $2`,
      [enrichment.existing_website, dissolution_id]
    );

    // 4. If we found an actual domain, add it to the domains table
    if (domain) {
      const tld = '.' + domain.split('.').slice(1).join('.');
      await query(
        `INSERT INTO domains (dissolution_id, domain, tld)
         VALUES ($1, $2, $3)
         ON CONFLICT (domain) DO NOTHING`,
        [dissolution_id, domain, tld]
      );
      console.log(`[enrichWKO] #${dissolution_id} "${companyName}": found domain ${domain}`);
    } else {
      console.log(`[enrichWKO] #${dissolution_id} "${companyName}": no domain found`);
    }
  },
  {
    connection,
    concurrency: 2,
    limiter: { max: 5, duration: 60_000 }, // respect WKO rate limits
  }
);

enrichWorker.on('completed', (job) => {
  console.log(`[enrichWKO] Job ${job.id} completed`);
});
enrichWorker.on('failed', (job, err) => {
  console.error(`[enrichWKO] Job ${job?.id} failed:`, err.message);
});

// ─── Worker: checkWhois ──────────────────────────────────────────────────────

const whoisWorker = new Worker(
  'checkWhois',
  async (_job: Job) => {
    // 1. Fetch batch of domains needing a check
    const result = await query(
      `SELECT id, domain FROM domains
       WHERE last_checked IS NULL
          OR last_checked < NOW() - INTERVAL '${WHOIS_INTERVAL_HOURS} hours'
       ORDER BY last_checked ASC NULLS FIRST
       LIMIT $1`,
      [WHOIS_BATCH_SIZE]
    );

    if (result.rowCount === 0) {
      console.log('[checkWhois] No domains to check');
      return;
    }

    console.log(`[checkWhois] Checking ${result.rowCount} domains...`);

    for (const row of result.rows) {
      try {
        // 2. Check WHOIS/RDAP registration status
        const check = await checkDomain(row.domain);

        // 3. Check if domain has a live website
        let isOnline: boolean | null = null;
        let httpStatus: number | null = null;
        let redirectUrl: string | null = null;

        if (check.status === 'registered' || check.status === 'expiring') {
          const httpCheck = await checkDomainOnline(row.domain);
          isOnline = httpCheck.is_online;
          httpStatus = httpCheck.http_status;
          redirectUrl = httpCheck.redirect_url;
        } else {
          isOnline = false;
        }

        // 4. Update domains table
        await query(
          `UPDATE domains
           SET status = $1,
               expiry_date = $2,
               registrar = $3,
               whois_raw = $4,
               rdap_raw = $5,
               is_online = $6,
               http_status = $7,
               redirect_url = $8,
               last_checked = NOW()
           WHERE id = $9`,
          [
            check.status,
            check.expiry_date ?? null,
            check.registrar ?? null,
            check.whois_raw ?? null,
            check.rdap_raw ? JSON.stringify(check.rdap_raw) : null,
            isOnline,
            httpStatus,
            redirectUrl,
            row.id,
          ]
        );
      } catch (err) {
        console.error(`[checkWhois] Error checking ${row.domain}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[checkWhois] Batch complete: ${result.rowCount} domains checked`);
  },
  {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 30_000 },
  }
);

whoisWorker.on('completed', (job) => {
  console.log(`[checkWhois] Job ${job.id} completed`);
});
whoisWorker.on('failed', (job, err) => {
  console.error(`[checkWhois] Job ${job?.id} failed:`, err.message);
});

// ─── Worker: sendAlerts ──────────────────────────────────────────────────────

const alertsWorker = new Worker(
  'sendAlerts',
  async (_job: Job) => {
    // 1. Find domains that need alerts
    const result = await query(
      `SELECT d.id, d.domain, d.status, d.expiry_date, d.dissolution_id
       FROM domains d
       WHERE d.alert_sent = false
         AND d.status IN ('available', 'expiring', 'redemption')
       ORDER BY d.created_at ASC
       LIMIT 50`
    );

    if (result.rowCount === 0) {
      console.log('[sendAlerts] No pending alerts');
      return;
    }

    const domains = result.rows;
    console.log(`[sendAlerts] Sending alerts for ${domains.length} domains...`);

    // 2. Send alerts (Telegram + ntfy)
    const alertPayload = domains.map((d) => ({
      domain: d.domain,
      status: d.status,
      expiry_date: d.expiry_date,
    }));

    await Promise.allSettled([
      sendBatchAlert(alertPayload),
      sendNtfyBatchAlert(alertPayload),
    ]);

    // 3. Log to alert_log and mark alert_sent
    for (const d of domains) {
      await query(
        `INSERT INTO alert_log (domain_id, alert_type, payload)
         VALUES ($1, $2, $3)`,
        [
          d.id,
          d.status === 'available' ? 'domain_available' : 'domain_expiring',
          JSON.stringify({ domain: d.domain, status: d.status, expiry_date: d.expiry_date }),
        ]
      );

      await query(
        `UPDATE domains SET alert_sent = true WHERE id = $1`,
        [d.id]
      );
    }

    console.log(`[sendAlerts] Sent alerts for ${domains.length} domains`);
  },
  {
    connection,
    concurrency: 1,
    limiter: { max: 2, duration: 60_000 },
  }
);

alertsWorker.on('completed', (job) => {
  console.log(`[sendAlerts] Job ${job.id} completed`);
});
alertsWorker.on('failed', (job, err) => {
  console.error(`[sendAlerts] Job ${job?.id} failed:`, err.message);
});

// ─── Worker: scoreDomain ────────────────────────────────────────────────────

const scoreDomainWorker = new Worker(
  'scoreDomain',
  async (_job: Job) => {
    // Fetch domains that haven't been scored or scored > 7 days ago
    const result = await query(
      `SELECT id, domain FROM domains
       WHERE scored_at IS NULL
          OR scored_at < NOW() - INTERVAL '7 days'
       ORDER BY scored_at ASC NULLS FIRST
       LIMIT 20`
    );

    if (result.rowCount === 0) {
      console.log('[scoreDomain] No domains to score');
      return;
    }

    console.log(`[scoreDomain] Scoring ${result.rowCount} domains...`);

    const domainNames = result.rows.map((r) => r.domain as string);
    const scores = await scoreDomainBatch(domainNames);

    for (const score of scores) {
      const row = result.rows.find((r) => r.domain === score.domain);
      if (!row) continue;

      await query(
        `UPDATE domains
         SET backlink_count = $1,
             referring_domains = $2,
             domain_authority = $3,
             organic_keywords = $4,
             page_rank = $5,
             seo_score = $6,
             score_raw = $7,
             scored_at = $8
         WHERE id = $9`,
        [
          score.backlink_count,
          score.referring_domains,
          score.domain_authority,
          score.organic_keywords,
          score.page_rank,
          score.seo_score,
          JSON.stringify(score.score_raw),
          score.scored_at,
          row.id,
        ]
      );
    }

    console.log(`[scoreDomain] Scored ${scores.length} domains`);
  },
  {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 60_000 },
  }
);

scoreDomainWorker.on('completed', (job) => {
  console.log(`[scoreDomain] Job ${job.id} completed`);
});
scoreDomainWorker.on('failed', (job, err) => {
  console.error(`[scoreDomain] Job ${job?.id} failed:`, err.message);
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('[Worker] Starting AustrianDomainWatch workers...');

  // Register repeatable jobs
  await setupScheduler();

  console.log('[Worker] All workers running. Waiting for jobs...');
}

main().catch((err) => {
  console.error('[Worker] Fatal startup error:', err);
  process.exit(1);
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

  await Promise.allSettled([
    ediktsdateiWorker.close(),
    gisaWorker.close(),
    enrichWorker.close(),
    whoisWorker.close(),
    alertsWorker.close(),
    scoreDomainWorker.close(),
  ]);

  await connection.quit();
  console.log('[Worker] Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
