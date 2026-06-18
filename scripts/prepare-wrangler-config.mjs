import { readFile, writeFile } from 'node:fs/promises';

const databaseId = process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID;

if (!databaseId) {
  throw new Error('Missing D1_DATABASE_ID or CLOUDFLARE_D1_DATABASE_ID');
}

const path = new URL('../wrangler.jsonc', import.meta.url);
const config = await readFile(path, 'utf8');

if (!config.includes('__D1_DATABASE_ID__')) {
  process.exit(0);
}

await writeFile(path, config.replaceAll('__D1_DATABASE_ID__', databaseId));
