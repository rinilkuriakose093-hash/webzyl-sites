/*
  Scans Cloudflare KV values for JSON that fails parsing due to BOM/control chars
  and rewrites them as clean JSON.

  Usage:
    node tools/scan_and_fix_kv_json.js --namespace-id <id> --prefix config: [--dry-run]

  Notes:
    - Uses `wrangler kv key list/get/put` so it works with your current wrangler auth.
    - Only rewrites values that successfully parse after sanitization.
*/

const { execFileSync } = require('node:child_process');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const namespaceId = getArg('--namespace-id');
const prefix = getArg('--prefix') ?? 'config:';
const dryRun = process.argv.includes('--dry-run');

if (!namespaceId) {
  console.error('Missing --namespace-id');
  process.exit(2);
}

function runWrangler(args) {
  return execFileSync('wrangler', args, { encoding: 'utf8' });
}

function sanitize(text) {
  return String(text)
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function tryParseJSON(text) {
  return JSON.parse(text);
}

function main() {
  const listRaw = runWrangler(['kv', 'key', 'list', '--remote', '--namespace-id', namespaceId, '--prefix', prefix]);

  let keys;
  try {
    keys = JSON.parse(listRaw);
  } catch (e) {
    console.error('Failed to parse key list JSON from wrangler. Output was:');
    console.error(listRaw);
    process.exit(1);
  }

  const keyNames = keys.map((k) => k.name).filter(Boolean);
  console.log(`Found ${keyNames.length} keys with prefix '${prefix}'.`);

  let fixed = 0;
  let skipped = 0;
  let invalid = 0;

  for (const key of keyNames) {
    let text;
    try {
      text = runWrangler(['kv', 'key', 'get', key, '--remote', '--namespace-id', namespaceId, '--text']);
    } catch (e) {
      console.warn(`[WARN] Failed to get ${key}: ${e.message}`);
      skipped++;
      continue;
    }

    const original = text;

    // Fast path: valid JSON already.
    try {
      tryParseJSON(original);
      continue;
    } catch (_) {
      // fall through
    }

    const sanitized = sanitize(original);

    // If sanitization didn’t change anything, it’s truly invalid JSON.
    if (sanitized === original) {
      console.warn(`[INVALID] ${key} JSON parse failed and sanitization made no changes.`);
      invalid++;
      continue;
    }

    let obj;
    try {
      obj = tryParseJSON(sanitized);
    } catch (e) {
      console.warn(`[INVALID] ${key} still fails after sanitization: ${e.message}`);
      invalid++;
      continue;
    }

    const rewritten = JSON.stringify(obj);

    console.log(`[FIX] ${key} (len ${original.length} -> ${rewritten.length})${dryRun ? ' [dry-run]' : ''}`);

    if (!dryRun) {
      try {
        runWrangler(['kv', 'key', 'put', key, rewritten, '--remote', '--namespace-id', namespaceId]);
        fixed++;
      } catch (e) {
        console.warn(`[WARN] Failed to put ${key}: ${e.message}`);
        skipped++;
      }
    }
  }

  console.log('---');
  console.log(`Fixed: ${fixed}`);
  console.log(`Invalid (needs manual fix): ${invalid}`);
  console.log(`Skipped (get/put errors): ${skipped}`);
}

main();
