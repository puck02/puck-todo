import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../wrangler.jsonc', import.meta.url);
const target = new URL('../wrangler.ci.jsonc', import.meta.url);
const config = JSON.parse(await readFile(source, 'utf8'));

delete config.routes;
config.workers_dev = true;

await writeFile(target, `${JSON.stringify(config, null, 2)}\n`);
