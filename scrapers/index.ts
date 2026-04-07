export interface ScraperResult {
  company_name: string;
  court?: string;
  proceeding_type: string;
  gazette_date: string;
  source_url?: string;
  source_ref?: string;
  raw_data?: Record<string, unknown>;
}

export interface ScraperAdapter {
  name: string;
  source: string;
  run(): Promise<ScraperResult[]>;
}

import { EdiktsdateiScraper } from './ediktsdatei';
import { GisaScraper } from './gisa';
import { JustizScraper } from './justiz';

const scrapers: ScraperAdapter[] = [
  new EdiktsdateiScraper(),
  new GisaScraper(),
  new JustizScraper(),
];

export function getAllScrapers(): ScraperAdapter[] {
  return scrapers;
}

export function getScraperBySource(source: string): ScraperAdapter | undefined {
  return scrapers.find((s) => s.source === source);
}

export { EdiktsdateiScraper } from './ediktsdatei';
export { GisaScraper } from './gisa';
export { JustizScraper } from './justiz';
export { enrichCompany } from './wko';
