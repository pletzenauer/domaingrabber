import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let _connection: IORedis | null = null;

function getConnection(): IORedis {
  if (!_connection) {
    _connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    _connection.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
  }
  return _connection;
}

function createQueue(name: string, opts: object = {}) {
  return new Queue(name, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
      ...opts,
    },
  });
}

// Lazy queue getters to avoid connecting during Next.js build
let _scrapeEdiktsdateiQueue: Queue;
let _scrapeGISAQueue: Queue;
let _enrichWKOQueue: Queue;
let _checkWhoisQueue: Queue;
let _scoreDomainQueue: Queue;
let _sendAlertsQueue: Queue;

export function getScrapeEdiktsdateiQueue() {
  if (!_scrapeEdiktsdateiQueue) _scrapeEdiktsdateiQueue = createQueue('scrapeEdiktsdatei');
  return _scrapeEdiktsdateiQueue;
}
export function getScrapeGISAQueue() {
  if (!_scrapeGISAQueue) _scrapeGISAQueue = createQueue('scrapeGISA', { backoff: { type: 'exponential', delay: 10000 } });
  return _scrapeGISAQueue;
}
export function getEnrichWKOQueue() {
  if (!_enrichWKOQueue) _enrichWKOQueue = createQueue('enrichWKO', { removeOnComplete: { count: 200 } });
  return _enrichWKOQueue;
}
export function getCheckWhoisQueue() {
  if (!_checkWhoisQueue) _checkWhoisQueue = createQueue('checkWhois', { attempts: 2, backoff: { type: 'fixed', delay: 15000 }, removeOnComplete: { count: 500 }, removeOnFail: { count: 1000 } });
  return _checkWhoisQueue;
}
export function getScoreDomainQueue() {
  if (!_scoreDomainQueue) _scoreDomainQueue = createQueue('scoreDomain', { attempts: 2, backoff: { type: 'fixed', delay: 10000 }, removeOnComplete: { count: 500 } });
  return _scoreDomainQueue;
}
export function getSendAlertsQueue() {
  if (!_sendAlertsQueue) _sendAlertsQueue = createQueue('sendAlerts', { removeOnFail: { count: 200 } });
  return _sendAlertsQueue;
}

// Backwards-compatible exports
export const scrapeEdiktsdateiQueue = { get add() { return getScrapeEdiktsdateiQueue().add.bind(getScrapeEdiktsdateiQueue()); }, get upsertJobScheduler() { return getScrapeEdiktsdateiQueue().upsertJobScheduler.bind(getScrapeEdiktsdateiQueue()); } } as unknown as Queue;
export const scrapeGISAQueue = { get add() { return getScrapeGISAQueue().add.bind(getScrapeGISAQueue()); }, get upsertJobScheduler() { return getScrapeGISAQueue().upsertJobScheduler.bind(getScrapeGISAQueue()); } } as unknown as Queue;
export const enrichWKOQueue = { get add() { return getEnrichWKOQueue().add.bind(getEnrichWKOQueue()); }, get upsertJobScheduler() { return getEnrichWKOQueue().upsertJobScheduler.bind(getEnrichWKOQueue()); } } as unknown as Queue;
export const checkWhoisQueue = { get add() { return getCheckWhoisQueue().add.bind(getCheckWhoisQueue()); }, get upsertJobScheduler() { return getCheckWhoisQueue().upsertJobScheduler.bind(getCheckWhoisQueue()); } } as unknown as Queue;
export const scoreDomainQueue = { get add() { return getScoreDomainQueue().add.bind(getScoreDomainQueue()); }, get upsertJobScheduler() { return getScoreDomainQueue().upsertJobScheduler.bind(getScoreDomainQueue()); } } as unknown as Queue;
export const sendAlertsQueue = { get add() { return getSendAlertsQueue().add.bind(getSendAlertsQueue()); }, get upsertJobScheduler() { return getSendAlertsQueue().upsertJobScheduler.bind(getSendAlertsQueue()); } } as unknown as Queue;

// --- Scheduler setup ---

export async function setupScheduler(): Promise<void> {
  await getScrapeEdiktsdateiQueue().upsertJobScheduler(
    'scrapeEdiktsdatei-daily',
    { pattern: '0 8 * * *', tz: 'Europe/Vienna' },
    { name: 'scrapeEdiktsdatei', data: {} }
  );

  await getScrapeGISAQueue().upsertJobScheduler(
    'scrapeGISA-weekly',
    { pattern: '0 2 * * 0', tz: 'Europe/Vienna' },
    { name: 'scrapeGISA', data: {} }
  );

  await getCheckWhoisQueue().upsertJobScheduler(
    'checkWhois-periodic',
    { pattern: '0 */6 * * *', tz: 'Europe/Vienna' },
    { name: 'checkWhois', data: {} }
  );

  await getScoreDomainQueue().upsertJobScheduler(
    'scoreDomain-periodic',
    { pattern: '0 */12 * * *', tz: 'Europe/Vienna' },
    { name: 'scoreDomain', data: {} }
  );

  await getSendAlertsQueue().upsertJobScheduler(
    'sendAlerts-periodic',
    { pattern: '*/30 * * * *', tz: 'Europe/Vienna' },
    { name: 'sendAlerts', data: {} }
  );

  console.log('Job schedulers configured successfully');
}

export { getConnection as getRedisConnection };
