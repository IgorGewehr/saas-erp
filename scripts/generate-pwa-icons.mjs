/**
 * Gera os ícones do PWA a partir de public/icon.png (512x512, quadrado vermelho com o nó branco).
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * - icon-192.png / icon-512.png: propósito "any" (a arte inteira).
 * - icon-maskable-512.png: propósito "maskable" — o Android recorta em círculo/squircle e só
 *   garante o miolo de 80%; a arte fica em ~76% sobre fundo vermelho liso (as faixas escuras do
 *   topo/base do original são descartadas).
 * Saída em public/icons/ (versionada — não precisa rodar no build).
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SOURCE = 'public/icon.png';
const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const PNG = { compressionLevel: 9, palette: true, quality: 85 };

await sharp(SOURCE).resize(192, 192).png(PNG).toFile(`${OUT}/icon-192.png`);
await sharp(SOURCE).resize(512, 512).png(PNG).toFile(`${OUT}/icon-512.png`);

// O original tem vinheta (bordas mais escuras que o centro): encolher a arte sobre um fundo liso
// deixaria uma "caixa" visível. Por isso o fundo usa a cor MÉDIA da borda da arte recortada e a arte
// entra com a borda esfumada (máscara com blur), sem emenda.
const INNER = 390;
const inner = await sharp(SOURCE)
  .extract({ left: 21, top: 21, width: 470, height: 470 })
  .resize(INNER, INNER)
  .png()
  .toBuffer();

const STRIP = 6;
const strips = [
  { left: 0, top: 0, width: INNER, height: STRIP },
  { left: 0, top: INNER - STRIP, width: INNER, height: STRIP },
  { left: 0, top: 0, width: STRIP, height: INNER },
  { left: INNER - STRIP, top: 0, width: STRIP, height: INNER },
];
const totals = [0, 0, 0];
let pixels = 0;
for (const region of strips) {
  const { data, info } = await sharp(inner).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    totals[0] += data[i];
    totals[1] += data[i + 1];
    totals[2] += data[i + 2];
    pixels++;
  }
}
const background = { r: Math.round(totals[0] / pixels), g: Math.round(totals[1] / pixels), b: Math.round(totals[2] / pixels), alpha: 1 };

const feather = await sharp(Buffer.from(
  `<svg width="${INNER}" height="${INNER}"><rect x="7" y="7" width="${INNER - 14}" height="${INNER - 14}" rx="4" fill="#fff"/></svg>`,
)).blur(4).png().toBuffer();
const softInner = await sharp(inner).composite([{ input: feather, blend: 'dest-in' }]).png().toBuffer();

const offset = (512 - INNER) / 2;
await sharp({ create: { width: 512, height: 512, channels: 4, background } })
  .composite([{ input: softInner, left: offset, top: offset }])
  .png(PNG)
  .toFile(`${OUT}/icon-maskable-512.png`);

console.log('fundo', background);
