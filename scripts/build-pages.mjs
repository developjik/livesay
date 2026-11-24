import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Keep the local demo server's /demo and /dist URL contract under a Pages base.
const out = process.argv[2] ?? '_site';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('demo', out, { recursive: true });
await cp('dist', join(out, 'dist'), { recursive: true });
for (const name of await readdir(out)) {
  if (!/\.(html|js)$/.test(name)) continue;
  const path = join(out, name);
  let text = await readFile(path, 'utf8');
  text = text.replaceAll('/demo/', './').replaceAll('/dist/', './dist/');
  text = text.replace(/(["'])\/(bad|good)\.html/g, '$1./$2.html');
  text = text.replace('href="/"', 'href="./"');
  await writeFile(path, text);
}
