import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { responsivePartsImages, widthsForImage, responsiveImagePath } from './lib/responsive-parts-images.mjs';

// Optional asset-generation dependency; deploys use the committed files, not sharp.
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = new URL('../', import.meta.url);
await mkdir(new URL('assets/responsive/', root), { recursive: true });
const manifest = [];
for (const item of responsivePartsImages) {
  const input = await readFile(new URL(item.source, root));
  const metadata = await sharp(input).metadata();
  if (metadata.width !== item.width || metadata.height !== item.height) throw new Error(`Unexpected dimensions: ${item.source} ${metadata.width}x${metadata.height}`);
  for (const width of widthsForImage(item)) {
    const output = responsiveImagePath(item, width);
    await sharp(input).resize({ width, withoutEnlargement: true }).webp({ quality: 95, effort: 6 }).toFile(fileURLToPath(new URL(output, root)));
    manifest.push({ source: item.source, output, width, height: Math.round(width * item.height / item.width), bytes: (await stat(new URL(output, root))).size });
  }
}
await writeFile(new URL('assets/responsive/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${manifest.length} responsive images; originals untouched.`);
