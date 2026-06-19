import { readFile, writeFile } from 'node:fs/promises';

const databaseId = process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID;

if (!databaseId) {
  throw new Error('Missing D1_DATABASE_ID or CLOUDFLARE_D1_DATABASE_ID');
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId)) {
  throw new Error('D1 database id must be a UUID from Cloudflare D1, not the database name or account id');
}

const path = new URL('../wrangler.jsonc', import.meta.url);
const config = await readFile(path, 'utf8');

if (!config.includes('__D1_DATABASE_ID__')) {
  process.exit(0);
}

await writeFile(path, config.replaceAll('__D1_DATABASE_ID__', databaseId));
