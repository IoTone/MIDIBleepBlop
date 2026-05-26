#!/usr/bin/env node
// Convert vendored pencilresearch/midi CSVs into per-device JSON files.
//
// Walks vendor/pencilresearch-midi/<Manufacturer>/<device>.csv, parses each
// row according to the upstream schema, normalizes fields, and writes one
// JSON file per device into packages/catalog/devices/.
//
// Generated JSON files are committed (not regenerated at install time) so
// catalog diffs are reviewable in PRs and the consumer install doesn't need
// a CSV parser.
//
// Schema documented in docs/device-catalog.md. License attribution in
// THIRD-PARTY-NOTICES.md. Refresh via: npm run build:catalog

import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const vendorDir = join(repoRoot, 'vendor/pencilresearch-midi');
const outDir = join(repoRoot, 'packages/catalog/devices');

// ─── CSV parser ─────────────────────────────────────────────────────────────
// Handles quoted fields, embedded commas, and "" escape inside quotes.
// Returns rows as arrays of strings (no header handling).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      // Drop blank trailing rows
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Final field if file doesn't end with newline
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

// ─── normalisation helpers ──────────────────────────────────────────────────
function nullIfEmpty(v) {
  if (v === undefined || v === null) return null;
  const trimmed = String(v).trim();
  return trimmed === '' ? null : trimmed;
}

function intOrNull(v) {
  const s = nullIfEmpty(v);
  if (s === null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function orientationOf(v) {
  const s = nullIfEmpty(v)?.toLowerCase();
  if (s === 'centered') return 'centered';
  return '0-based';
}

function slugify(...parts) {
  return parts
    .map((p) => String(p).toLowerCase())
    .join('-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function filenameFor(manufacturer, device) {
  // Title-case words split on whitespace, joined with hyphens. Preserves words
  // that are already all-uppercase in the source so abbreviations like "NTS-1"
  // and "KORG" survive intact. Lowercase tokens like "fm" still get title-cased
  // to "Fm" — we don't second-guess the source data's intent.
  const titleCase = (s) =>
    s
      .split(/\s+/)
      .map((w) => {
        if (w.length === 0) return '';
        if (w.length >= 2 && w === w.toUpperCase()) return w;
        return w[0].toUpperCase() + w.slice(1).toLowerCase();
      })
      .join('-');
  return `${titleCase(manufacturer)}-${titleCase(device)}.json`;
}

// ─── row → Parameter ────────────────────────────────────────────────────────
const COLUMNS = [
  'manufacturer',
  'device',
  'section',
  'parameter_name',
  'parameter_description',
  'cc_msb',
  'cc_lsb',
  'cc_min_value',
  'cc_max_value',
  'cc_default_value',
  'nrpn_msb',
  'nrpn_lsb',
  'nrpn_min_value',
  'nrpn_max_value',
  'nrpn_default_value',
  'orientation',
  'notes',
  'usage',
];

function rowToParameter(row) {
  const r = Object.fromEntries(COLUMNS.map((c, i) => [c, row[i] ?? '']));

  const ccMin = intOrNull(r.cc_min_value);
  const ccMax = intOrNull(r.cc_max_value);

  const nrpnMsb = intOrNull(r.nrpn_msb);
  const nrpnLsb = intOrNull(r.nrpn_lsb);
  const nrpn =
    nrpnMsb !== null && nrpnLsb !== null
      ? {
          msb: nrpnMsb,
          lsb: nrpnLsb,
          range: {
            min: intOrNull(r.nrpn_min_value) ?? 0,
            max: intOrNull(r.nrpn_max_value) ?? 16383,
          },
          default: intOrNull(r.nrpn_default_value),
        }
      : null;

  return {
    section: nullIfEmpty(r.section),
    name: nullIfEmpty(r.parameter_name) ?? '(unnamed)',
    description: nullIfEmpty(r.parameter_description),
    cc: intOrNull(r.cc_msb),
    ccRange: { min: ccMin ?? 0, max: ccMax ?? 127 },
    ccDefault: intOrNull(r.cc_default_value),
    orientation: orientationOf(r.orientation),
    usage: nullIfEmpty(r.usage),
    notes: nullIfEmpty(r.notes),
    nrpn,
  };
}

// ─── walk & convert ─────────────────────────────────────────────────────────
function findCSVs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findCSVs(full));
    } else if (entry.endsWith('.csv') && entry !== 'template.csv') {
      out.push(full);
    }
  }
  return out;
}

function convertOne(csvPath) {
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);
  if (rows.length === 0) {
    return { skipped: csvPath, reason: 'empty file' };
  }
  // Skip the header row
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    return { skipped: csvPath, reason: 'no data rows' };
  }

  // Derive manufacturer/device from the first row (they should be uniform per file)
  const first = dataRows[0];
  const manufacturer = nullIfEmpty(first[0]) ?? 'Unknown';
  const device = nullIfEmpty(first[1]) ?? 'Unknown';

  const parameters = dataRows.map(rowToParameter);

  const sourceRel = relative(repoRoot, csvPath);
  const slug = slugify(manufacturer, device);

  const json = {
    _source: sourceRel,
    _license: 'CC-BY-SA-4.0 (see THIRD-PARTY-NOTICES.md)',
    manufacturer,
    device,
    slug,
    parameters,
  };

  const outFile = join(outDir, filenameFor(manufacturer, device));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(json, null, 2) + '\n');
  return { written: relative(repoRoot, outFile), count: parameters.length };
}

// ─── main ───────────────────────────────────────────────────────────────────
const csvs = findCSVs(vendorDir);
if (csvs.length === 0) {
  process.stderr.write(`No CSVs found under ${relative(repoRoot, vendorDir)}/\n`);
  process.stderr.write(
    'Run scripts/refresh-catalog.mjs to vendor upstream data, or manually drop CSVs in vendor/.\n',
  );
  process.exit(1);
}

// Clear devices/ so stale files (e.g. from renamed devices, or case differences
// on case-insensitive filesystems like macOS APFS) don't linger.
if (existsSync(outDir)) {
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.json')) rmSync(join(outDir, f));
  }
}

let written = 0;
let skipped = 0;
let totalParams = 0;
for (const csv of csvs) {
  const result = convertOne(csv);
  if (result.written) {
    process.stdout.write(`✓ ${result.written}  (${result.count} parameters)\n`);
    written++;
    totalParams += result.count;
  } else {
    process.stdout.write(`- skipped ${relative(repoRoot, result.skipped)}: ${result.reason}\n`);
    skipped++;
  }
}

// Generate index.json for runtime discovery
const indexEntries = [];
const allDevices = [];
for (const f of readdirSync(outDir).sort()) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  const json = JSON.parse(readFileSync(join(outDir, f), 'utf8'));
  indexEntries.push({
    file: f,
    slug: json.slug,
    manufacturer: json.manufacturer,
    device: json.device,
    parameters: json.parameters.length,
  });
  // Strip the metadata-only fields for the lens-side TS map; preserve the data.
  const { _source, _license, ...rest } = json;
  allDevices.push({ source: _source, data: rest });
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(indexEntries, null, 2) + '\n');

// Generate lens/MidiBleepBop.lspkg/Scripts/Devices.ts — Lens Studio can't load
// JSON assets at runtime, so we ship the catalog as TypeScript constants the
// LS bundler can consume. The DeviceCatalogComponent looks up by slug.
const devicesTsPath = join(repoRoot, 'lens/MidiBleepBop.lspkg/Scripts/Devices.ts');
const devicesTsBody = [
  '// AUTO-GENERATED by scripts/build-catalog.mjs — DO NOT EDIT BY HAND.',
  '// Source CSVs vendored under vendor/pencilresearch-midi/.',
  '// License: CC-BY-SA-4.0 (see THIRD-PARTY-NOTICES.md).',
  '// Regenerate via: npm run build:catalog',
  '',
  "import type { Device } from './MidiBleepBop';",
  '',
  '/** All devices bundled with the library, keyed by slug (e.g. "korg-volca-bass"). */',
  'export const DEVICES: Record<string, Device> = {',
];
for (const { source, data } of allDevices) {
  devicesTsBody.push(`  // Source: ${source}`);
  devicesTsBody.push(`  ${JSON.stringify(data.slug)}: ${JSON.stringify(data, null, 2)
    .split('\n')
    .map((l, i) => (i === 0 ? l : '  ' + l))
    .join('\n')},`);
  devicesTsBody.push('');
}
devicesTsBody.push('};');
devicesTsBody.push('');
devicesTsBody.push('/** Slug list, sorted. Useful for inspector enumeration / debugging. */');
devicesTsBody.push('export const DEVICE_SLUGS: string[] = Object.keys(DEVICES).sort();');
devicesTsBody.push('');
mkdirSync(dirname(devicesTsPath), { recursive: true });
writeFileSync(devicesTsPath, devicesTsBody.join('\n'));

process.stdout.write(
  `\n${written} device(s) written, ${skipped} skipped, ${totalParams} parameters total.\n`,
);
process.stdout.write(`Index: ${relative(repoRoot, join(outDir, 'index.json'))}\n`);
process.stdout.write(`Lens TS map: ${relative(repoRoot, devicesTsPath)}\n`);
