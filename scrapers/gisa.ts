import axios from 'axios';
import { parse } from 'csv-parse/sync';
import type { ScraperAdapter, ScraperResult } from './index';

/**
 * GISA (Gewerbeinformationssystem Austria) Scraper
 *
 * Data source: data.gv.at open data CSV (updated monthly)
 * Direct URL: ZIP file containing GISA-OpenData.csv
 *
 * IMPORTANT: The GISA open data CSV is partially anonymized — it contains
 * trade types, locations, and status but NOT company names for natural persons.
 * Only entries with INHABER_PERS_ART = 'J' (juristische Person / legal entity)
 * may have identifiable business info via the GEWERBEWORTLAUT field.
 *
 * The old CKAN API (data.gv.at/katalog/api/3/action/package_show) has been
 * replaced by a Vue.js SPA and no longer returns JSON.
 */

const DIRECT_CSV_URL =
  'https://www.data.gv.at/katalog/dataset/e49a1510-9d93-4277-8467-48a1efc9f046/resource/5739b17a-8e92-466f-8a42-84d4eb3e0f18/download/gewerbe_in_oesterreich.csv';

/**
 * Parse date strings in Austrian/European formats to ISO YYYY-MM-DD.
 */
function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  const trimmed = dateStr.trim();

  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return new Date().toISOString().slice(0, 10);
}

/**
 * Download and extract the GISA CSV from the ZIP file.
 * The data.gv.at download URL returns a ZIP despite having a .csv extension.
 */
async function downloadCsv(): Promise<string> {
  console.log(`[GISA] Downloading from ${DIRECT_CSV_URL}...`);

  const response = await axios.get(DIRECT_CSV_URL, {
    timeout: 120_000,
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'AustrianDomainWatch/1.0' },
    maxContentLength: 500 * 1024 * 1024,
  });

  const buffer = Buffer.from(response.data);
  const sizeMb = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`[GISA] Downloaded ${sizeMb} MB`);

  // Check if the response is a ZIP file (magic bytes PK\x03\x04)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    console.log(`[GISA] Detected ZIP archive, extracting...`);
    // Use built-in Node.js zlib for simple ZIP extraction
    // ZIP files have a local file header starting with PK\x03\x04
    return extractFirstFileFromZip(buffer);
  }

  // Not a ZIP, treat as raw CSV
  return buffer.toString('utf-8');
}

/**
 * Extract the first CSV file from a ZIP buffer.
 * Reads the central directory (at end of ZIP) to get accurate file sizes,
 * since local file headers may have zero-length sizes (data descriptor format).
 */
function extractFirstFileFromZip(zipBuffer: Buffer): string {
  // Find End of Central Directory record (EOCD) — scan backwards from end
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (
      zipBuffer[i] === 0x50 &&
      zipBuffer[i + 1] === 0x4b &&
      zipBuffer[i + 2] === 0x05 &&
      zipBuffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP: End of Central Directory not found');
  }

  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const centralDirEntries = zipBuffer.readUInt16LE(eocdOffset + 10);

  console.log(`[GISA] ZIP central directory: ${centralDirEntries} entries at offset ${centralDirOffset}`);

  // Parse central directory entries (PK\x01\x02)
  let cdOffset = centralDirOffset;
  for (let i = 0; i < centralDirEntries; i++) {
    if (
      zipBuffer[cdOffset] !== 0x50 ||
      zipBuffer[cdOffset + 1] !== 0x4b ||
      zipBuffer[cdOffset + 2] !== 0x01 ||
      zipBuffer[cdOffset + 3] !== 0x02
    ) {
      break;
    }

    const compressionMethod = zipBuffer.readUInt16LE(cdOffset + 10);
    const compressedSize = zipBuffer.readUInt32LE(cdOffset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cdOffset + 24);
    const fileNameLength = zipBuffer.readUInt16LE(cdOffset + 28);
    const extraFieldLength = zipBuffer.readUInt16LE(cdOffset + 30);
    const commentLength = zipBuffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cdOffset + 42);
    const fileName = zipBuffer.toString('utf-8', cdOffset + 46, cdOffset + 46 + fileNameLength);

    console.log(`[GISA] ZIP entry: "${fileName}" (${compressionMethod === 0 ? 'stored' : 'deflated'}, ${(compressedSize / 1024 / 1024).toFixed(1)} MB compressed, ${(uncompressedSize / 1024 / 1024).toFixed(1)} MB uncompressed)`);

    if (fileName.toLowerCase().endsWith('.csv')) {
      // Read local file header to find data start
      const localFileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraFieldLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;

      if (compressionMethod === 0) {
        return zipBuffer.toString('utf-8', dataStart, dataStart + compressedSize);
      } else if (compressionMethod === 8) {
        const { inflateRawSync } = require('zlib');
        const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize);
        const decompressed = inflateRawSync(compressed);
        console.log(`[GISA] Decompressed ${(decompressed.length / 1024 / 1024).toFixed(1)} MB`);
        return decompressed.toString('utf-8');
      }
    }

    // Move to next central directory entry
    cdOffset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  throw new Error('No CSV file found in ZIP archive');
}

export class GisaScraper implements ScraperAdapter {
  name = 'GISA Open Data';
  source = 'gisa';

  async run(): Promise<ScraperResult[]> {
    console.log(`[${this.name}] Starting scrape...`);

    let csvData: string;
    try {
      csvData = await downloadCsv();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${this.name}] Failed to download GISA data: ${msg}`);
      console.log(`[${this.name}] The GISA open data source may be temporarily unavailable.`);
      return [];
    }

    // Parse CSV (semicolon-delimited, Austrian government standard)
    const headerLine = csvData.split('\n')[0]?.trim() || '';
    console.log(`[${this.name}] CSV header: ${headerLine.slice(0, 300)}`);

    // Detect delimiter
    const semicolons = (headerLine.match(/;/g) || []).length;
    const commas = (headerLine.match(/,/g) || []).length;
    const delimiter = semicolons >= commas ? ';' : ',';

    let rows: Record<string, string | undefined>[];
    try {
      rows = parse(csvData, {
        delimiter,
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
        quote: '"',
        escape: '"',
      });
    } catch (parseErr) {
      console.error(`[${this.name}] CSV parse failed:`, parseErr instanceof Error ? parseErr.message : parseErr);
      return [];
    }

    console.log(`[${this.name}] Parsed ${rows.length} total rows`);

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]!);
      console.log(`[${this.name}] Columns: ${columns.join(', ')}`);
    }

    // Known columns from data.gv.at GISA dataset:
    // NUTS1, NUTS2, NUTS3, LAU1, LAU2, ADRESS_ART, GEWERBESCHLUESSEL,
    // GEWERBEWORTLAUT, GEWERBEART, POSTLEITZAHL, ORTSCHAFT,
    // RECHTSWIRKSAM, RUHEND_VON, INHABER_PERS_ART

    // Filter for dormant (ruhend) businesses — these have RUHEND_VON set
    const results: ScraperResult[] = [];
    let dormantCount = 0;
    let legalEntityDormant = 0;

    for (const row of rows) {
      const ruhendVon = (row['RUHEND_VON'] || row['ruhend_von'] || '').trim();
      if (!ruhendVon) continue;

      dormantCount++;

      // Only process legal entities (juristische Personen) as they have
      // identifiable business names more likely to have domain names
      const persArt = (row['INHABER_PERS_ART'] || row['inhaber_pers_art'] || '').trim();
      if (persArt !== 'J') continue;

      legalEntityDormant++;

      // Use GEWERBEWORTLAUT as the company/trade description
      // This isn't a company name per se, but for legal entities it often
      // contains identifiable business information
      const gewerbeWortlaut = (row['GEWERBEWORTLAUT'] || row['gewerbewortlaut'] || '').trim();
      const gewerbeArt = (row['GEWERBEART'] || row['gewerbeart'] || '').trim();
      const plz = (row['POSTLEITZAHL'] || row['postleitzahl'] || '').trim();
      const ort = (row['ORTSCHAFT'] || row['ortschaft'] || '').trim();
      const location = [plz, ort].filter(Boolean).join(' ');

      // Skip if no meaningful trade description
      if (!gewerbeWortlaut || gewerbeWortlaut.length < 3) continue;

      results.push({
        company_name: gewerbeWortlaut,
        court: location || undefined,
        proceeding_type: 'gewerbe_ruhend',
        gazette_date: parseDate(ruhendVon),
        source_url: 'https://data.gv.at/katalog/dataset/gisa',
        source_ref: row['GEWERBESCHLUESSEL'] || row['gewerbeschluessel'] || undefined,
        raw_data: {
          gewerbeart: gewerbeArt || undefined,
          plz: plz || undefined,
          ort: ort || undefined,
          inhaber_pers_art: persArt,
          ruhend_von: ruhendVon,
        },
      });
    }

    console.log(`[${this.name}] Stats: ${rows.length} total, ${dormantCount} dormant, ${legalEntityDormant} legal entity dormant`);
    console.log(`[${this.name}] Returning ${results.length} results (dormant legal entities with trade descriptions)`);

    if (results.length === 0 && dormantCount > 0) {
      console.log(`[${this.name}] Note: ${dormantCount} dormant entries found but none were legal entities with usable trade descriptions.`);
      console.log(`[${this.name}] The GISA open data does not contain company names — only trade descriptions.`);
      console.log(`[${this.name}] For company-level dissolution data, the Ediktsdatei scraper is the primary source.`);
    }

    return results;
  }
}
