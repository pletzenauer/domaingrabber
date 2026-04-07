import { NextRequest, NextResponse } from 'next/server';
import {
  scrapeEdiktsdateiQueue,
  scrapeGISAQueue,
  checkWhoisQueue,
  sendAlertsQueue,
  scoreDomainQueue,
} from '@/lib/queue';

const QUEUE_MAP: Record<string, typeof scrapeEdiktsdateiQueue> = {
  scrapeEdiktsdatei: scrapeEdiktsdateiQueue,
  scrapeGISA: scrapeGISAQueue,
  checkWhois: checkWhoisQueue,
  sendAlerts: sendAlertsQueue,
  scoreDomain: scoreDomainQueue,
};

const VALID_JOBS = Object.keys(QUEUE_MAP);

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
