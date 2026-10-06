// Generates the app icons and the notification badge in public/icons from the basket of the demo.
// Run with `pnpm icons` after changing the shape or the colors.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const BASKET = '<path d="M4.5 10h15l-1.5 8.2a2 2 0 0 1-2 1.8H8a2 2 0 0 1-2-1.8z"/><path d="M8.5 10 12 4.5 15.5 10"/><path d="M10 13.5v3M14 13.5v3"/>';
// --panel and --panel-ink of the dark theme.
const PANEL = '#2F95D4';
const PANEL_INK = '#04192A';

function svg({ size, background, radius = 0, basketSize, stroke }) {
  const offset = (size - basketSize) / 2;
  const tile = background ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${tile}<svg x="${offset}" y="${offset}" width="${basketSize}" height="${basketSize}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BASKET}</svg></svg>`;
}

// Same proportions as the brand mark of the demo: a rounded tile, basket at 61%.
const appIcon = (size) => svg({ size, background: PANEL, radius: size * 0.22, basketSize: size * 0.61, stroke: PANEL_INK });

// Full bleed for Android masks. The visible basket, strokes included, fills about 73% of its box; it
// stays in the central 56%, inside both the 20% margin and the round mask.
const maskableIcon = (size) => svg({ size, background: PANEL, basketSize: (size * 0.56) / 0.73, stroke: PANEL_INK });

// Android draws only the alpha channel of a badge: white on transparent.
const badge = (size) => svg({ size, basketSize: size * 0.9, stroke: '#FFFFFF' });

const iconPath = (file) => fileURLToPath(new URL(`../public/icons/${file}`, import.meta.url));
const png = (source, file) => sharp(Buffer.from(source)).png().toFile(iconPath(file));

await writeFile(iconPath('icon.svg'), appIcon(64));
await png(appIcon(192), 'icon-192.png');
await png(appIcon(512), 'icon-512.png');
await png(maskableIcon(512), 'icon-maskable-512.png');
await png(badge(96), 'badge-96.png');
