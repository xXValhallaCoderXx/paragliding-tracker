import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const assets = join(root, 'assets/images');
const brand = join(root, 'assets/brand');
const source = await readFile(join(brand, 'paraglider-mark.svg'), 'utf8');
const artwork = source.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
const forest = '#203F36';
const cream = '#FFFCF5';

// Keep all Android foreground pixels inside the central 66/108 safe circle.
// The standalone icon can be larger because the OS only rounds its outer corners.
function svg({ scale = 1, background, monochrome = false, mask } = {}) {
  const mark = monochrome ? artwork.replace(/#[0-9A-F]{6}/gi, cream) : artwork;
  const shape = mask === 'circle'
    ? '<circle cx="128" cy="128" r="128" fill="white"/>'
    : '<rect width="256" height="256" rx="56" fill="white"/>';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256" fill="none">
    ${mask ? `<defs><clipPath id="mask">${shape}</clipPath></defs><g clip-path="url(#mask)">` : ''}
    ${background ? `<rect width="256" height="256" fill="${background}"/>` : ''}
    <g transform="translate(128 128) scale(${scale}) translate(-130 -128)">${mark}</g>
    ${mask ? '</g>' : ''}
  </svg>`);
}

await mkdir(assets, { recursive: true });
const variants = [
  ['icon.png', { scale: 1, background: forest }],
  ['android-icon-foreground.png', { scale: 0.72 }],
  ['android-icon-monochrome.png', { scale: 0.72, monochrome: true }],
  ['splash-icon.png', { scale: 1 }],
];
for (const [name, options] of variants) {
  const raster = sharp(svg(options));
  // App Store icons must have no alpha channel, even when every pixel is opaque.
  if (options.background) raster.removeAlpha();
  await raster.png().toFile(join(assets, name));
}

// A transparent logo for reuse without the launcher's full-bleed background.
await sharp(svg()).png().toFile(join(brand, 'paraglider-mark.png'));
await sharp(svg({ background: forest, mask: 'rounded' })).resize(512).png()
  .toFile(join(brand, 'icon-preview.png'));

// Side-by-side previews use the same Android foreground scale as the build assets.
const previews = [];
for (const [index, options] of [
  { scale: 0.72, background: forest, mask: 'circle' },
  { scale: 0.72, background: forest, mask: 'rounded' },
  { scale: 0.72, background: '#4F6257', monochrome: true, mask: 'circle' },
].entries()) {
  // Launchers show the central 72dp viewport of a 108dp adaptive layer.
  const mask = options.mask === 'circle'
    ? '<circle cx="96" cy="96" r="96" fill="white"/>'
    : '<rect width="192" height="192" rx="42" fill="white"/>';
  const viewport = await sharp(svg({ ...options, mask: undefined }))
    .resize(288).png().toBuffer();
  const input = await sharp(viewport).extract({ left: 48, top: 48, width: 192, height: 192 })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192">${mask}</svg>`), blend: 'dest-in' }])
    .png().toBuffer();
  previews.push({ input, top: 32, left: 32 + index * 224 });
}
await sharp({ create: { width: 704, height: 256, channels: 4, background: '#F7F3E8' } })
  .composite(previews).png().toFile(join(brand, 'adaptive-preview.png'));

await writeFile(join(brand, 'paraglider-mark-on-light.svg'), source
  .replaceAll('#FFFCF5', forest));
console.log('Generated app, adaptive, monochrome, splash and reusable logo assets.');
