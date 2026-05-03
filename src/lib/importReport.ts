// PDF importer for weekly report dashboards.
// Parses the Afflix Core dashboard layout (orange-banded sections) and maps
// extracted text into a partial WeeklyReportContent. Best-effort: anything we
// can't find is left for the user to fill in manually.
//
// Strategy:
//   1. Read all pages with pdfjs-dist; collect text items + link annotations
//      with absolute (x, y) coordinates (y stacked across pages).
//   2. Group nearby Y items into "lines"; group nearby X within a line into
//      "cells" so multi-word values stay together.
//   3. Find section header lines by exact text match; everything between two
//      section headers is that section's content.
//   4. Per section, run a tailored extractor.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  WeeklyReportContent, TopCreator, TopVideo, ProductRow, ListingQuality,
  emptyOverall, emptyVideoPerf, emptyGmvMax, emptyShopHealth,
} from './reportSchema';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface LinkAnno {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Cell {
  text: string;
  x: number;
  width: number;
  items: TextItem[];
}
interface Line {
  y: number;
  cells: Cell[];
  text: string;       // full line text (cells joined by space)
}

export interface ImportedReportMeta {
  brand_name?: string;
  week_number?: number;
  week_start?: string;
  week_end?: string;
}

export interface ParsedReport {
  meta: ImportedReportMeta;
  content: Partial<WeeklyReportContent>;
  warnings: string[];
}

const Y_TOL = 3;
const X_CELL_GAP = 6;  // text items closer than this on the same Y are joined into one cell

const SECTION_HEADERS = [
  'Week-over-week comparison',
  'Shop Performance Score',
  'Top Creators',
  'Top Videos — This Week',
  'Top Videos — Last Week',
  'Video Performance',
  'Overall GMV Max Performance',
  'Product Highlights',
  'Shop Health',
  'Insights',
];

export async function parseReportPdf(file: File): Promise<ParsedReport> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const items: TextItem[] = [];
  const links: LinkAnno[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    // Stack pages vertically so a single Y axis covers the whole document.
    // Use 1.1× page height as offset so adjacent pages don't accidentally collide.
    const yOffset = (pageNum - 1) * viewport.height * 1.1;

    const content = await page.getTextContent();
    for (const it of content.items as any[]) {
      const text = String(it.str ?? '');
      if (text.trim().length === 0) continue;
      const x = it.transform[4];
      const y = viewport.height - it.transform[5] + yOffset;
      items.push({
        str: text, x, y,
        width: it.width ?? 0,
        height: it.height ?? 12,
      });
    }

    const annos = await page.getAnnotations();
    for (const a of annos) {
      if (a.subtype === 'Link' && a.url && Array.isArray(a.rect)) {
        const [x1, y1, x2, y2] = a.rect;
        links.push({
          url: a.url,
          x: Math.min(x1, x2),
          y: viewport.height - Math.max(y1, y2) + yOffset,
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        });
      }
    }
  }

  const lines = groupLines(items);
  const warnings: string[] = [];
  const content: Partial<WeeklyReportContent> = {};
  const meta: ImportedReportMeta = {};

  // Header (brand, week #, dates)
  parseHeader(lines, meta, warnings);

  // KPI grid (6 cards)
  const overall = parseKpiGrid(lines);
  if (overall) content.overall = overall;
  else warnings.push('Could not read the KPI grid');

  // Section blocks
  const sections = sliceSections(lines);

  // Video Performance (4 mini stats)
  if (sections['Video Performance']) {
    const vp = parseVideoPerformance(sections['Video Performance']);
    if (vp) content.video_performance = vp;
    else warnings.push('Could not read Video Performance');
  }

  // GMV Max (5 mini stats + optional notes)
  if (sections['Overall GMV Max Performance']) {
    const gm = parseGmvMax(sections['Overall GMV Max Performance']);
    if (gm) content.gmv_max = gm;
    else warnings.push('Could not read GMV Max');
  }

  // Top Creators
  if (sections['Top Creators']) {
    const creators = parseTopCreators(sections['Top Creators']);
    if (creators.length > 0) content.top_creators = creators;
  }

  // Top Videos — This Week (with link annotations)
  if (sections['Top Videos — This Week']) {
    const videos = parseTopVideos(sections['Top Videos — This Week'], links);
    if (videos.length > 0) content.top_videos = videos;
  }

  // Product Highlights
  if (sections['Product Highlights']) {
    const products = parseProductHighlights(sections['Product Highlights']);
    if (products.length > 0) content.product_highlights = products;
  }

  // Shop Health
  if (sections['Shop Health']) {
    content.shop_health = parseShopHealth(sections['Shop Health']);
  }

  // Insights (free text)
  if (sections['Insights']) {
    const html = parseInsights(sections['Insights']);
    if (html) content.insights = { summary: html };
  }

  return { meta, content, warnings };
}

// ---------------------------------------------------------------------------
// line / cell grouping

function groupLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rawLines: TextItem[][] = [];
  for (const it of sorted) {
    const last = rawLines[rawLines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= Y_TOL) last.push(it);
    else rawLines.push([it]);
  }
  return rawLines.map(lineItems => {
    lineItems.sort((a, b) => a.x - b.x);
    // Join nearby x items into cells
    const cells: Cell[] = [];
    for (const it of lineItems) {
      const last = cells[cells.length - 1];
      if (last && it.x - (last.x + last.width) <= X_CELL_GAP) {
        last.text += it.str;
        last.width = (it.x + it.width) - last.x;
        last.items.push(it);
      } else {
        cells.push({ text: it.str, x: it.x, width: it.width, items: [it] });
      }
    }
    cells.forEach(c => { c.text = c.text.replace(/\s+/g, ' ').trim(); });
    return {
      y: lineItems[0].y,
      cells,
      text: cells.map(c => c.text).join(' '),
    };
  });
}

// ---------------------------------------------------------------------------
// header

function parseHeader(lines: Line[], meta: ImportedReportMeta, warnings: string[]) {
  // The dashboard title looks like: "TEST BRAND — Week #8"
  const titleLine = lines.find(l => /Week\s*#\s*\d+/i.test(l.text));
  if (titleLine) {
    const m = titleLine.text.match(/^(.+?)\s*[—\-–]\s*Week\s*#\s*(\d+)/i);
    if (m) {
      meta.brand_name = m[1].trim();
      meta.week_number = parseInt(m[2], 10);
    }
  } else {
    warnings.push('Could not find brand / week header');
  }

  // Date range like "May 17, 2026 – May 23, 2026 submitted"
  const dateRegex = /([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(\d{4})\s*[–\-]\s*([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(\d{4})/;
  for (const l of lines) {
    const m = l.text.match(dateRegex);
    if (m) {
      const [, m1, d1, y1, m2, d2, y2] = m;
      const start = parseDate(m1, +d1, +y1);
      const end = parseDate(m2, +d2, +y2);
      if (start) meta.week_start = start;
      if (end) meta.week_end = end;
      break;
    }
  }
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
function parseDate(monthName: string, day: number, year: number): string | undefined {
  const m = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (!m) return undefined;
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// KPI grid

const KPI_LABEL_TO_FIELD: Record<string, string> = {
  'TOTAL GMV': 'total_gmv',
  'AFFILIATE GMV': 'affiliate_gmv',
  'ORDERS': 'orders',
  'SAMPLES APPROVED': 'samples_approved',
  'PENDING COLLABS': 'pending_collabs',
  'AD SPEND': 'ad_spend',
};

function parseKpiGrid(lines: Line[]): WeeklyReportContent['overall'] | null {
  const o = emptyOverall();
  let foundAny = false;
  for (const [label, field] of Object.entries(KPI_LABEL_TO_FIELD)) {
    const labelCell = findLabelCell(lines, label);
    if (!labelCell) continue;
    // Look for the next line within ~50px below at similar X
    const valueLine = lines.find(l =>
      l.y > labelCell.y && l.y < labelCell.y + 60 &&
      l.cells.some(c => Math.abs(c.x - labelCell.x) < 60),
    );
    if (!valueLine) continue;
    const valueCell = valueLine.cells.find(c => Math.abs(c.x - labelCell.x) < 60);
    if (!valueCell) continue;
    const raw = valueCell.text.trim();
    if (field === 'ad_spend' && /not\s*started/i.test(raw)) {
      o.ad_spend_not_started = true;
      o.ad_spend = 0;
    } else {
      const num = parseNum(raw);
      if (num != null) {
        if (field === 'ad_spend') o.ad_spend_not_started = false;
        (o as any)[field] = num;
        foundAny = true;
      }
    }
  }
  return foundAny ? o : null;
}

interface LabelHit { x: number; y: number; cell: Cell; line: Line; }
function findLabelCell(lines: Line[], label: string): LabelHit | null {
  for (const l of lines) {
    for (const c of l.cells) {
      if (c.text === label) return { x: c.x, y: l.y, cell: c, line: l };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// section slicing — return the Lines that belong to each section

function sliceSections(lines: Line[]): Record<string, Line[]> {
  const headerLines: { name: string; idx: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    for (const name of SECTION_HEADERS) {
      // Use startsWith to handle "GMV trend (last 8 weeks)" etc.
      if (text === name || text.startsWith(name)) {
        headerLines.push({ name, idx: i });
        break;
      }
    }
  }
  const out: Record<string, Line[]> = {};
  for (let i = 0; i < headerLines.length; i++) {
    const { name, idx } = headerLines[i];
    const next = headerLines[i + 1];
    const slice = lines.slice(idx + 1, next ? next.idx : lines.length);
    out[name] = slice;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Video Performance: 4 mini stats — TOTAL VIDEOS / VIDEO VIEWS / CTR / CTOR

function parseVideoPerformance(lines: Line[]): WeeklyReportContent['video_performance'] | null {
  const vp = emptyVideoPerf();
  const map: Record<string, keyof typeof vp> = {
    'TOTAL VIDEOS': 'total_videos_posted',
    'VIDEO VIEWS': 'video_views',
    'CTR': 'ctr',
    'CTOR': 'ctor',
  };
  let foundAny = false;
  for (const [label, field] of Object.entries(map)) {
    const labelHit = findInLines(lines, label);
    if (!labelHit) continue;
    const value = findValueBelow(lines, labelHit);
    if (value == null) continue;
    const n = parseNum(value);
    if (n != null) {
      (vp as any)[field] = n;
      foundAny = true;
    }
  }
  return foundAny ? vp : null;
}

// ---------------------------------------------------------------------------
// GMV Max: 5 mini stats. If "Not yet started" alert visible, mark not_yet_started.

function parseGmvMax(lines: Line[]): WeeklyReportContent['gmv_max'] | null {
  const gm = emptyGmvMax();
  // If the section has "Not yet started" line, treat as not started.
  if (lines.some(l => /Not\s+yet\s+started/i.test(l.text))) {
    gm.not_yet_started = true;
    return gm;
  }
  const map: Record<string, keyof typeof gm> = {
    'AD SPEND': 'ad_spend',
    'ROI': 'roi',
    'ORDERS': 'orders',
    'CPO': 'cpo',
    'GMV': 'gmv',
  };
  let foundAny = false;
  for (const [label, field] of Object.entries(map)) {
    const hit = findInLines(lines, label);
    if (!hit) continue;
    const value = findValueBelow(lines, hit);
    if (value == null) continue;
    const n = parseNum(value);
    if (n != null) {
      (gm as any)[field] = n;
      foundAny = true;
    }
  }
  if (foundAny) gm.not_yet_started = false;
  return foundAny ? gm : null;
}

function findInLines(lines: Line[], text: string): LabelHit | null {
  for (const l of lines) {
    for (const c of l.cells) {
      if (c.text === text) return { x: c.x, y: l.y, cell: c, line: l };
    }
  }
  return null;
}
function findValueBelow(lines: Line[], hit: LabelHit, dyMax = 60, dxMax = 70): string | null {
  for (const l of lines) {
    if (l.y <= hit.y || l.y > hit.y + dyMax) continue;
    const c = l.cells.find(c => Math.abs(c.x - hit.x) <= dxMax);
    if (c) return c.text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top Creators table — Creator | Videos | Items sold | GMV

function parseTopCreators(lines: Line[]): TopCreator[] {
  const headerLine = lines.find(l => /Creator/i.test(l.text) && /GMV/i.test(l.text) && /Videos/i.test(l.text));
  if (!headerLine) return [];
  const colXs = mapColumnXs(headerLine, ['Creator', 'Videos', 'Items', 'GMV']);
  if (!colXs) return [];
  const dataLines = lines.filter(l => l.y > headerLine.y);
  const out: TopCreator[] = [];
  for (const l of dataLines) {
    const row = matchRow(l, colXs);
    if (!row || row.every(v => !v)) continue;
    out.push({
      name: row[0] ?? '',
      videos: parseNum(row[1]) ?? 0,
      items_sold: parseNum(row[2]) ?? 0,
      gmv: parseNum(row[3]) ?? 0,
      notes: '',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top Videos — This Week. Columns: Creator | Items sold | GMV. Capture link annos.

function parseTopVideos(lines: Line[], links: LinkAnno[]): TopVideo[] {
  const headerLine = lines.find(l => /Creator/i.test(l.text) && /GMV/i.test(l.text) && /Items/i.test(l.text));
  if (!headerLine) return [];
  const colXs = mapColumnXs(headerLine, ['Creator', 'Items', 'GMV']);
  if (!colXs) return [];
  const dataLines = lines.filter(l => l.y > headerLine.y);
  const out: TopVideo[] = [];
  for (const l of dataLines) {
    const row = matchRow(l, colXs);
    if (!row || row.every(v => !v)) continue;
    // Link: find a link annotation overlapping the Creator cell of this line
    const creatorCell = l.cells.find(c => Math.abs(c.x - (colXs[0] ?? 0)) < 50);
    let url = '';
    if (creatorCell) {
      const link = links.find(a =>
        Math.abs(a.y + a.height / 2 - l.y) < 18 &&
        a.x <= creatorCell.x + creatorCell.width + 4 &&
        a.x + a.width >= creatorCell.x - 4
      );
      if (link) url = link.url;
    }
    out.push({
      creator_name: row[0] ?? '',
      video_url: url,
      items_sold: parseNum(row[1]) ?? 0,
      gmv: parseNum(row[2]) ?? 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Product Highlights — Product | Total Units | Affiliate Units | Total GMV | Videos | Listing Quality

function parseProductHighlights(lines: Line[]): ProductRow[] {
  const headerLine = lines.find(l =>
    /Product/.test(l.text) && /Total\s+Units/.test(l.text) && /Listing\s+Quality/.test(l.text)
  );
  if (!headerLine) return [];
  const colXs = mapColumnXs(headerLine, ['Product', 'Total Units', 'Affiliate Units', 'Total GMV', 'Videos', 'Listing Quality']);
  if (!colXs) return [];
  const dataLines = lines.filter(l => l.y > headerLine.y);
  const out: ProductRow[] = [];
  for (const l of dataLines) {
    const row = matchRow(l, colXs);
    if (!row || row.every(v => !v)) continue;
    out.push({
      product_id: '',
      product_name: row[0] ?? '',
      total_units_sold: parseNum(row[1]) ?? 0,
      affiliate_units_sold: parseNum(row[2]) ?? 0,
      total_gmv: parseNum(row[3]) ?? 0,
      videos_posted: parseNum(row[4]) ?? 0,
      listing_quality: parseListingQuality(row[5]),
      notes: '',
    });
  }
  return out;
}
function parseListingQuality(v: string | undefined): ListingQuality {
  if (!v) return '';
  const t = v.trim().toLowerCase();
  if (t.startsWith('excellent')) return 'excellent';
  if (t.startsWith('good')) return 'good';
  if (t.startsWith('fair')) return 'fair';
  if (t.startsWith('poor')) return 'poor';
  return '';
}

// ---------------------------------------------------------------------------
// Shop Health — 4 ratings (out of 5) + Dispatching/Replying status + Warnings/Violations

function parseShopHealth(lines: Line[]): WeeklyReportContent['shop_health'] {
  const sh = emptyShopHealth();
  const ratingMap: Record<string, keyof typeof sh> = {
    'Shop Performance': 'shop_performance_score',
    'Product Satisfaction': 'product_satisfaction_rating',
    'Fulfillment': 'fulfillment_rating',
    'Customer Service': 'customer_service_rating',
  };
  for (const [label, field] of Object.entries(ratingMap)) {
    const hit = lines.find(l => l.cells.some(c => c.text.startsWith(label)));
    if (!hit) continue;
    const labelCell = hit.cells.find(c => c.text.startsWith(label));
    if (!labelCell) continue;
    const valueLine = lines.find(l =>
      l.y > hit.y && l.y < hit.y + 50 &&
      l.cells.some(c => Math.abs(c.x - labelCell.x) < 60),
    );
    if (!valueLine) continue;
    const valueCell = valueLine.cells.find(c => Math.abs(c.x - labelCell.x) < 60);
    if (!valueCell) continue;
    // Format like "1.0 /5" or "1.0/5"
    const m = valueCell.text.match(/(\d+(?:\.\d+)?)\s*\/?\s*5?/);
    if (m) (sh as any)[field] = parseFloat(m[1]);
  }
  // Status fields
  const statusMap: Record<string, keyof typeof sh> = {
    'Dispatching on time': 'dispatching_on_time',
    'Replying within 24h': 'replying_within_24h',
  };
  for (const [label, field] of Object.entries(statusMap)) {
    const hit = lines.find(l => l.cells.some(c => c.text.startsWith(label)));
    if (!hit) continue;
    const labelCell = hit.cells.find(c => c.text.startsWith(label));
    if (!labelCell) continue;
    const valueLine = lines.find(l =>
      l.y > hit.y && l.y < hit.y + 50 &&
      l.cells.some(c => Math.abs(c.x - labelCell.x) < 60),
    );
    if (!valueLine) continue;
    const valueCell = valueLine.cells.find(c => Math.abs(c.x - labelCell.x) < 60);
    if (!valueCell) continue;
    const t = valueCell.text.toLowerCase();
    if (t.startsWith('yes')) (sh as any)[field] = 'yes';
    else if (t.startsWith('no')) (sh as any)[field] = 'no';
    else (sh as any)[field] = 'not_rated';
  }
  // Boolean fields
  const boolMap: Record<string, keyof typeof sh> = {
    'Warnings this week': 'warnings_received',
    'Violations this week': 'violations_received',
  };
  for (const [label, field] of Object.entries(boolMap)) {
    const hit = lines.find(l => l.cells.some(c => c.text.startsWith(label)));
    if (!hit) continue;
    const labelCell = hit.cells.find(c => c.text.startsWith(label));
    if (!labelCell) continue;
    const valueLine = lines.find(l =>
      l.y > hit.y && l.y < hit.y + 50 &&
      l.cells.some(c => Math.abs(c.x - labelCell.x) < 60),
    );
    if (!valueLine) continue;
    const valueCell = valueLine.cells.find(c => Math.abs(c.x - labelCell.x) < 60);
    if (!valueCell) continue;
    (sh as any)[field] = valueCell.text.toLowerCase().startsWith('yes');
  }
  return sh;
}

// ---------------------------------------------------------------------------
// Insights — convert remaining text to <p>-wrapped HTML

function parseInsights(lines: Line[]): string {
  // Drop any trailing page-number blips and join remaining lines as paragraphs.
  const text = lines
    .map(l => l.text.trim())
    .filter(t => t.length > 0)
    .filter(t => !/^\d+$/.test(t))   // page numbers etc.
    .join('\n');
  if (text.trim().length === 0) return '';
  // Split on blank lines into paragraphs.
  const paras = text.split(/\n{2,}|\r?\n/).map(p => p.trim()).filter(Boolean);
  return paras.map(p => `<p>${escapeHtml(p)}</p>`).join('');
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// row helpers

function mapColumnXs(headerLine: Line, expectedHeaders: string[]): number[] | null {
  const xs: number[] = [];
  for (const name of expectedHeaders) {
    // Match the cell whose text starts with the column header name (case-insensitive)
    const target = name.toLowerCase();
    const cell = headerLine.cells.find(c => c.text.toLowerCase().startsWith(target));
    if (!cell) return null;
    xs.push(cell.x);
  }
  return xs;
}

function matchRow(line: Line, colXs: number[]): string[] | null {
  // For each expected column X, pick the cell in the line whose X is closest.
  // We tolerate up to ~80px distance.
  const out: string[] = [];
  for (let i = 0; i < colXs.length; i++) {
    const targetX = colXs[i];
    const nextX = colXs[i + 1] ?? Infinity;
    // Take cells whose X is between targetX − 30 and nextX − 8
    const cellsInCol = line.cells.filter(c =>
      c.x >= targetX - 30 && c.x < (nextX === Infinity ? Number.MAX_VALUE : nextX - 8)
    );
    if (cellsInCol.length === 0) {
      out.push('');
      continue;
    }
    // Join all cells in this column into a single value
    out.push(cellsInCol.map(c => c.text).join(' ').trim());
  }
  // Drop "rows" that look like page numbers / footer junk
  if (out.every(v => v === '' || /^\d+$/.test(v) && parseInt(v) < 100)) return null;
  return out;
}

// ---------------------------------------------------------------------------
// numeric parsing — handle "$1,234.56", "1.00%", "Not started", etc.

function parseNum(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length === 0 || s === '—' || s === '-') return null;
  if (/^not\s*started$/i.test(s) || /^not\s*yet/i.test(s)) return null;
  // Strip currency / percent / arrows / commas
  const cleaned = s.replace(/[↑↗↙↓→←]/g, '')
    .replace(/[$,]/g, '')
    .replace(/%/g, '')
    .trim();
  if (cleaned.length === 0) return null;
  // First number token
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}
