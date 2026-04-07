import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

// --- Queue definitions ---

export const scrapeEdiktsdateiQueue = new Queue('scrapeEdiktsdatei', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const scrapeGISAQueue = new Queue('scrapeGISA', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const enrichWKOQueue = new Queue('enrichWKO', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export const checkWhoisQueue = new Queue('checkWhois', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 15000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

export const scoreDomainQueue = new Queue('scoreDomain', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

export const sendAlertsQueue = new Queue('sendAlerts', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

// --- Scheduler setup ---

export async function setupScheduler(): Promise<void> {
  // scrapeEdiktsdatei: daily at 08:00 CET
  await scrapeEdiktsdateiQueue.upsertJobScheduler(
    'scrapeEdiktsdatei-daily',
    {
      pattern: '0 8 * * *',
      tz: 'Europe/Vienna',
    },
    {
      name: 'scrapeEdiktsdatei',
      data: {},
    }
  );

  // scrapeGISA: weekly Sunday at 02:00 CET
  await scrapeGISAQueue.upsertJobScheduler(
    'scrapeGISA-weekly',
    {
      pattern: '0 2 * * 0',
      tz: 'Europe/Vienna',
    },
    {
      name: 'scrapeGISA',
      data: {},
    }
  );

  // checkWhois: every 6 hours
  await checkWhoisQueue.upsertJobScheduler(
    'checkWhois-periodic',
    {
      pattern: '0 */6 * * *',
      tz: 'Europe/Vienna',
    },
    {
      name: 'checkWhois',
      data: {},
    }
  );

  // scoreDomain: every 12 hours
  await scoreDomainQueue.upsertJobScheduler(
    'scoreDomain-periodic',
    {
      pattern: '0 */12 * * *',
      tz: 'Europe/Vienna',
    },
    {
      name: 'scoreDomain',
      data: {},
    }
  );

  // sendAlerts: every 30 minutes
  await sendAlertsQueue.upsertJobScheduler(
    'sendAlerts-periodic',
    {
      pattern: '*/30 * * * *',
      tz: 'Europe/Vienna',
    },
    {
      name: 'sendAlerts',
      data: {},
    }
  );

  console.log('Job schedulers configured successfully');
}

export { connection as redisConnection };
