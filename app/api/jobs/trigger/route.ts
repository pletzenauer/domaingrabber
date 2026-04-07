import { NextRequest, NextResponse } from 'next/server';
import {
  scrapeEdiktsdateiQueue,
  scrapeGISAQueue,
  checkWhoisQueue,
  sendAlertsQueue,
  scoreDomainQueue,
  enrichWKOQueue,
} from '@/lib/queue';
import { query } from '@/lib/db';
import { isCompanyName } from '@/lib/domainGen';

const QUEUE_MAP: Record<string, typeof scrapeEdiktsdateiQueue> = {
  scrapeEdiktsdatei: scrapeEdiktsdateiQueue,
  scrapeGISA: scrapeGISAQueue,
  checkWhois: checkWhoisQueue,
  sendAlerts: sendAlertsQueue,
  scoreDomain: scoreDomainQueue,
};

const VALID_JOBS = [...Object.keys(QUEUE_MAP), 'reEnrich'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const jobName = body.job;

    if (!jobName || !VALID_JOBS.includes(jobName)) {
      return NextResponse.json(
        {
          error: `Invalid job name. Must be one of: ${VALID_JOBS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Special: reEnrich queues enrichment for all un-enriched companies
    if (jobName === 'reEnrich') {
      const result = await query(
        `SELECT id, company_name FROM dissolutions WHERE enriched_at IS NULL ORDER BY id`
      );

      let queued = 0;
      for (const row of result.rows) {
        // Only enrich companies, not natural persons
        if (!isCompanyName(row.company_name)) continue;
        await enrichWKOQueue.add('enrich', { dissolution_id: row.id });
        queued++;
      }

      return NextResponse.json({
        success: true,
        job: 'reEnrich',
        queued,
        total: result.rowCount,
      });
    }

    const queue = QUEUE_MAP[jobName];
    const job = await queue.add(`manual-${jobName}`, {}, {
      priority: 1, // higher priority than scheduled jobs
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      job: jobName,
    });
  } catch (err) {
    console.error('[API] POST /api/jobs/trigger error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
