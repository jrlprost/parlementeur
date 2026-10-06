// Images de partage (1200 × 630) générées au build : SVG écrit à la main, rendu en PNG par resvg.
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { layoutHemicycle } from './hemicycle';
import { THEME } from './colors';

export const W = 1200;
export const H = 630;
const BG = THEME.light.bg;
const INK = THEME.light.ink;
const FONT_DIR = path.resolve(process.cwd(), 'og-fonts');

export const ink = (a: number) => mixHex(BG, INK, a);

function mixHex(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Découpe grossière en lignes, à partir d'une largeur moyenne de caractère. */
export function wrap(text: string, size: number, maxWidth: number, charRatio = 0.5, maxLines = 3): string[] {
  const perLine = Math.max(8, Math.floor(maxWidth / (size * charRatio)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[\s,;:.]*\S*$/, '') + '…';
    return kept;
  }
  return lines;
}

export function textBlock(lines: string[], x: number, y: number, size: number, lh: number, attrs: string) {
  return lines.map((l, i) => `<text x="${x}" y="${y + i * size * lh}" font-size="${size}" ${attrs}>${esc(l)}</text>`).join('');
}

/** Hémicycle en SVG, à la position voulue, avec une couleur par siège. */
export function hemicycleSvg(fills: string[], x: number, y: number, width: number, highlight?: number) {
  const L = layoutHemicycle(fills.length);
  const k = width / L.width;
  const dots = L.seats
    .map((s, i) => {
      const cx = (x + s.x * k).toFixed(1);
      const cy = (y + s.y * k).toFixed(1);
      const r = (L.dot * k * (i === highlight ? 2.1 : 1)).toFixed(2);
      const stroke = i === highlight ? ` stroke="${INK}" stroke-width="3"` : '';
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fills[i]}"${stroke}/>`;
    });
  // Le siège mis en avant est dessiné en dernier, par-dessus les autres.
  if (highlight != null) dots.push(dots.splice(highlight, 1)[0]);
  return { svg: dots.join(''), height: L.height * k };
}

/** Barres horizontales étiquetées : libellé au-dessus, barre, valeur au bout. */
export function hbars(items: { label: string; value: number; display: string; color?: string }[], x: number, y: number, w: number, rowH = 54) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return items
    .map((it, i) => {
      const yy = y + i * rowH;
      const bw = Math.max(3, (it.value / max) * (w - 90));
      return `<text x="${x}" y="${yy}" font-family="Public Sans" font-weight="600" font-size="19" fill="${INK}">${esc(it.label)}</text>
        <rect x="${x}" y="${yy + 10}" width="${bw.toFixed(1)}" height="16" rx="3" fill="${it.color ?? INK}"/>
        <text x="${(x + bw + 10).toFixed(1)}" y="${yy + 24}" font-family="Public Sans" font-size="17" fill="${ink(0.62)}">${esc(it.display)}</text>`;
    })
    .join('');
}

/** Cadre commun : fond, marque, pied avec source. */
export function frame(inner: string, opts: { kicker: string; source: string }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="64" y="78" font-family="Spectral" font-weight="600" font-size="30" fill="${INK}">Parlementeur</text>
  <text x="${W - 64}" y="78" text-anchor="end" font-family="Public Sans" font-weight="600" font-size="17" letter-spacing="1.6" fill="${ink(0.62)}">${esc(opts.kicker.toUpperCase())}</text>
  <rect x="64" y="100" width="${W - 128}" height="1.5" fill="${ink(0.16)}"/>
  ${inner}
  <rect x="64" y="${H - 70}" width="${W - 128}" height="1.5" fill="${ink(0.16)}"/>
  <text x="64" y="${H - 34}" font-family="Public Sans" font-size="18" fill="${ink(0.62)}">${esc(opts.source)}</text>
  <text x="${W - 64}" y="${H - 34}" text-anchor="end" font-family="Public Sans" font-weight="700" font-size="20" fill="${INK}">parlementeur.fr</text>
</svg>`;
}

export function toPng(svg: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: {
      loadSystemFonts: false,
      fontFiles: ['Spectral-SemiBold.ttf', 'Spectral-Medium.ttf', 'PublicSans-400.ttf', 'PublicSans-600.ttf', 'PublicSans-700.ttf'].map((f) => path.join(FONT_DIR, f)),
      defaultFontFamily: 'Public Sans',
    },
  });
  return r.render().asPng();
}

export const pngResponse = (buf: Buffer) =>
  new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/png' } });

export { BG, INK };
