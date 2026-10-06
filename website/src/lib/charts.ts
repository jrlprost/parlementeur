// Graphiques rendus en SVG au build. Chaque point porte data-n (nom), data-g (groupe), data-v (valeur), data-s (slug) :
// un petit script commun affiche le député touché, sur mobile comme sur ordinateur.

export type Pt = { v: number; s: string; n: string; g: string; c?: string; label?: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (x: number) => x.toFixed(1);
const dot = (x: number, y: number, r: number, fill: string, p: Pt, extra = '') =>
  `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${fill}" data-n="${esc(p.n)}" data-g="${esc(p.g)}" data-v="${esc(p.label ?? String(p.v))}" data-s="${p.s}"${extra}/>`;

/** Place des points sur un axe sans chevauchement (essaim), renvoie leur décalage vertical. */
function dodge(xs: number[], r: number): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const placed: { x: number; y: number }[] = [];
  const ys = new Array(xs.length).fill(0);
  const d = r * 2 + 0.6;
  for (const [x, i] of order) {
    const near = placed.filter((p) => Math.abs(p.x - x) < d);
    let y = 0;
    for (let k = 0; k < 400; k++) {
      y = k === 0 ? 0 : Math.ceil(k / 2) * (d * 0.87) * (k % 2 ? 1 : -1);
      if (near.every((p) => Math.hypot(p.x - x, p.y - y) >= d)) break;
    }
    placed.push({ x, y });
    ys[i] = y;
  }
  return ys;
}

type Axis = { min: number; max: number; ticks: number[]; fmt: (v: number) => string; log?: boolean };

function scaleX(ax: Axis, x0: number, x1: number) {
  const t = (v: number) => (ax.log ? Math.log10(Math.max(v, 1)) : v);
  const a = t(ax.min), b = t(ax.max);
  return (v: number) => x0 + ((Math.min(Math.max(t(v), a), b) - a) / (b - a)) * (x1 - x0);
}

/** Essaim de points par groupe : une ligne par groupe, un point par député, trait = médiane. */
export function swarm(rows: { label: string; color: string; points: Pt[] }[], ax: Axis, refs: { v: number; label: string }[] = []): string {
  const W = 360, L = 58, R = 12, r = 2.9;
  const x = scaleX(ax, L, W - R);
  let y = 26;
  let body = '';
  for (const row of rows) {
    const xs = row.points.map((p) => x(p.v));
    const ys = dodge(xs, r);
    const half = Math.max(8, Math.max(0, ...ys.map(Math.abs)) + r + 2);
    const cy = y + half;
    const med = [...row.points].map((p) => p.v).sort((a, b) => a - b)[Math.floor(row.points.length / 2)];
    body += `<text x="0" y="${f1(cy + 4)}" class="rl">${esc(row.label)}</text>`;
    body += `<line x1="${L}" x2="${W - R}" y1="${f1(cy)}" y2="${f1(cy)}" class="base"/>`;
    body += row.points.map((p, i) => dot(xs[i], cy + ys[i], r, row.color, p)).join('');
    if (med != null) body += `<line x1="${f1(x(med))}" x2="${f1(x(med))}" y1="${f1(cy - half + 2)}" y2="${f1(cy + half - 2)}" class="med"/>`;
    y = cy + half + 6;
  }
  const H = y + 4;
  const ticks = ax.ticks.map((t) => `<line x1="${f1(x(t))}" x2="${f1(x(t))}" y1="18" y2="${f1(H - 4)}" class="grid"/><text x="${f1(x(t))}" y="12" class="tk" text-anchor="middle">${esc(ax.fmt(t))}</text>`).join('');
  // Repères : étiquettes alternées en haut et en bas pour ne pas se chevaucher.
  const ref = refs.map((rf, i) => `<line x1="${f1(x(rf.v))}" x2="${f1(x(rf.v))}" y1="18" y2="${f1(H - 4)}" class="ref"/><text x="${f1(x(rf.v) + 3)}" y="${f1(i % 2 ? H - 6 : 26)}" class="rt">${esc(rf.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${f1(H)}" class="chart swarm" role="img">${ticks}${ref}${body}</svg>`;
}

/** Pyramide des âges : femmes à gauche, hommes à droite. */
export function pyramid(bins: { label: string; f: number; h: number }[], colors: [string, string]): string {
  const W = 360, mid = W / 2, gap = 22, rowH = 17;
  const max = Math.max(...bins.flatMap((b) => [b.f, b.h]), 1);
  const w = (n: number) => (n / max) * (mid - gap - 26);
  const rows = [...bins].reverse();
  const body = rows
    .map((b, i) => {
      const y = 22 + i * rowH;
      return `<rect x="${f1(mid - gap - w(b.f))}" y="${y}" width="${f1(w(b.f))}" height="${rowH - 3}" fill="${colors[0]}" rx="1.5"/>` +
        `<rect x="${mid + gap}" y="${y}" width="${f1(w(b.h))}" height="${rowH - 3}" fill="${colors[1]}" rx="1.5"/>` +
        `<text x="${mid}" y="${y + 11}" text-anchor="middle" class="tk">${esc(b.label)}</text>` +
        (b.f ? `<text x="${f1(mid - gap - w(b.f) - 3)}" y="${y + 11}" text-anchor="end" class="vl">${b.f}</text>` : '') +
        (b.h ? `<text x="${f1(mid + gap + w(b.h) + 3)}" y="${y + 11}" class="vl">${b.h}</text>` : '');
    })
    .join('');
  const H = 22 + rows.length * rowH + 4;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><text x="${mid - gap}" y="12" text-anchor="end" class="hd">Femmes</text><text x="${mid + gap}" y="12" class="hd">Hommes</text>${body}</svg>`;
}

/** Grille d'unités : un carré par député. */
export function waffle(cells: { color: string; p: Pt }[], perRow = 29): string {
  const s = 12.2, g = 0.8;
  const rows = Math.ceil(cells.length / perRow);
  const body = cells
    .map((c, i) => `<rect x="${f1((i % perRow) * s)}" y="${f1(Math.floor(i / perRow) * s)}" width="${f1(s - g * 2)}" height="${f1(s - g * 2)}" rx="2" fill="${c.color}" data-n="${esc(c.p.n)}" data-g="${esc(c.p.g)}" data-v="${esc(c.p.label ?? '')}" data-s="${c.p.s}"/>`)
    .join('');
  return `<svg viewBox="0 0 ${f1(perRow * s)} ${f1(rows * s)}" class="chart waffle" role="img">${body}</svg>`;
}

/** Nuage de points à deux variables, avec les médianes qui découpent quatre zones commentées. */
export function scatter(pts: (Pt & { y: number })[], ax: Axis, ay: Axis, quad: [string, string, string, string]): string {
  const W = 360, H = 330, L = 34, B = 26, T = 10, R = 8;
  const x = scaleX(ax, L, W - R);
  const yS = scaleX(ay, H - B, T);
  const mx = [...pts].map((p) => p.v).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  const my = [...pts].map((p) => p.y).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  const grid =
    ax.ticks.map((t) => `<line x1="${f1(x(t))}" x2="${f1(x(t))}" y1="${T}" y2="${H - B}" class="grid"/><text x="${f1(x(t))}" y="${H - 8}" text-anchor="middle" class="tk">${esc(ax.fmt(t))}</text>`).join('') +
    ay.ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${f1(yS(t))}" y2="${f1(yS(t))}" class="grid"/><text x="${L - 4}" y="${f1(yS(t) + 3)}" text-anchor="end" class="tk">${esc(ay.fmt(t))}</text>`).join('');
  const med = `<line x1="${f1(x(mx))}" x2="${f1(x(mx))}" y1="${T}" y2="${H - B}" class="ref"/><line x1="${L}" x2="${W - R}" y1="${f1(yS(my))}" y2="${f1(yS(my))}" class="ref"/>`;
  const q = `<text x="${W - R - 2}" y="${T + 10}" text-anchor="end" class="qt">${esc(quad[0])}</text><text x="${L + 3}" y="${T + 10}" class="qt">${esc(quad[1])}</text><text x="${L + 3}" y="${H - B - 5}" class="qt">${esc(quad[2])}</text><text x="${W - R - 2}" y="${H - B - 5}" text-anchor="end" class="qt">${esc(quad[3])}</text>`;
  const dots = pts.map((p) => dot(x(p.v), yS(p.y), 2.6, p.c ?? 'var(--ink)', p, ' fill-opacity=".85"')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart scatter" role="img">${grid}${med}${q}${dots}</svg>`;
}

/** Courbe de concentration : part cumulée d'un total, députés classés du plus au moins actif. */
export function lorenz(values: number[], marks: number[]): { svg: string; at: Record<number, number> } {
  const W = 360, H = 250, L = 34, B = 26, T = 10, R = 10;
  const sorted = [...values].sort((a, b) => b - a);
  const tot = sorted.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const pts = sorted.map((v, i) => { acc += v; return [(i + 1) / sorted.length, acc / tot] as const; });
  const x = (p: number) => L + p * (W - L - R);
  const y = (p: number) => H - B - p * (H - B - T);
  const path = 'M' + [[0, 0] as const, ...pts].map(([a, b]) => `${f1(x(a))},${f1(y(b))}`).join('L');
  const at: Record<number, number> = {};
  let ann = '';
  for (const m of marks) {
    const share = pts[Math.max(0, Math.round(m * pts.length) - 1)][1];
    at[m] = share;
    // Étiquette sous le point, alignée à droite quand le point est dans la moitié droite du graphique.
    const right = x(m) > W * 0.45;
    ann += `<circle cx="${f1(x(m))}" cy="${f1(y(share))}" r="4" class="mk"/><text x="${f1(x(m) + (right ? -2 : 6))}" y="${f1(y(share) + 16)}" text-anchor="${right ? 'end' : 'start'}" class="an">${Math.round(m * 100)} % des députés → ${Math.round(share * 100)} % du total</text>`;
  }
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${L}" x2="${W - R}" y1="${f1(y(t))}" y2="${f1(y(t))}" class="grid"/><text x="${L - 4}" y="${f1(y(t) + 3)}" text-anchor="end" class="tk">${t * 100}%</text><text x="${f1(x(t))}" y="${H - 8}" text-anchor="middle" class="tk">${t * 100}%</text>`).join('');
  const eq = `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="ref"/><text x="${f1(x(0.62))}" y="${f1(y(0.55))}" class="qt">répartition égale</text>`;
  return { svg: `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${eq}<path d="${path}" class="curve"/>${ann}</svg>`, at };
}

/** Colonnes dans le temps (années), avec les pics annotés. */
export function columns(items: { k: number; n: number }[], note: (k: number) => string | null): string {
  const W = 360, H = 190, L = 6, B = 22, T = 18;
  const min = Math.min(...items.map((i) => i.k)), max = Math.max(...items.map((i) => i.k));
  const n = max - min + 1;
  const bw = (W - L * 2) / n;
  const top = Math.max(...items.map((i) => i.n), 1);
  const byK = new Map(items.map((i) => [i.k, i.n]));
  let body = '';
  for (let k = min; k <= max; k++) {
    const v = byK.get(k) ?? 0;
    const h = (v / top) * (H - B - T);
    const x = L + (k - min) * bw;
    if (v) body += `<rect x="${f1(x + 0.6)}" y="${f1(H - B - h)}" width="${f1(bw - 1.2)}" height="${f1(h)}" rx="1" class="col"/>`;
    const lab = note(k);
    if (lab && v) body += `<text x="${f1(x + bw / 2)}" y="${f1(H - B - h - 4)}" text-anchor="middle" class="an">${esc(lab)}</text>`;
    if ((k - min) % 10 === 0 || k === max) body += `<text x="${f1(x + bw / 2)}" y="${H - 6}" text-anchor="middle" class="tk">${k}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" class="base"/>${body}</svg>`;
}

/** Carte proportionnelle (treemap « squarified ») : la surface de chaque case est proportionnelle à sa valeur. */
export function treemap(items: { label: string; v: number; color?: string }[], W = 360, H = 300): string {
  const tot = items.reduce((a, b) => a + b.v, 0) || 1;
  const nodes = [...items].sort((a, b) => b.v - a.v).map((i) => ({ ...i, a: (i.v / tot) * W * H }));
  const out: { i: (typeof nodes)[number]; x: number; y: number; w: number; h: number }[] = [];
  let x = 0, y = 0, w = W, h = H;
  const worst = (row: typeof nodes, side: number) => {
    const s = row.reduce((a, b) => a + b.a, 0);
    const mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  let rest = nodes;
  while (rest.length) {
    const side = Math.min(w, h);
    let row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    rest = rest.slice(i);
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const r of row) { const ch = r.a / cw; out.push({ i: r, x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; w -= cw;
    } else {
      const ch = s / w;
      let cx = x;
      for (const r of row) { const cw = r.a / ch; out.push({ i: r, x: cx, y, w: cw, h: ch }); cx += cw; }
      y += ch; h -= ch;
    }
  }
  const body = out
    .map(({ i, x, y, w, h }, k) => {
      const fill = i.color ?? `color-mix(in srgb, var(--ramp-to) ${Math.round(95 - (k / out.length) * 70)}%, var(--ramp-from))`;
      const light = k > out.length * 0.45;
      const fits = w > 44 && h > 26;
      const words = i.label.split(/[ ,]+/);
      const line1 = fits ? esc(words.slice(0, 2).join(' ')) : '';
      return `<g><rect x="${f1(x + 1)}" y="${f1(y + 1)}" width="${f1(Math.max(0, w - 2))}" height="${f1(Math.max(0, h - 2))}" rx="3" fill="${fill}"><title>${esc(i.label)} : ${i.v.toLocaleString('fr-FR')}</title></rect>` +
        (fits ? `<text x="${f1(x + 6)}" y="${f1(y + 16)}" class="tm${light ? ' dk' : ''}">${line1}</text><text x="${f1(x + 6)}" y="${f1(y + 29)}" class="tmv${light ? ' dk' : ''}">${i.v.toLocaleString('fr-FR')}</text>` : '') + '</g>';
    })
    .join('');
  const alt = nodes.slice(0, 8).map((n) => `${n.label} : ${n.v.toLocaleString('fr-FR')}`).join(' ; ');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart treemap" role="img" aria-label="${esc(alt)}">${body}</svg>`;
}

/** Bande de répartition : tous les députés en points discrets, le député concerné en évidence. */
export function strip(all: number[], me: number, ax: { min: number; max: number; log?: boolean }, color: string, groupMed?: number): string {
  const W = 360, H = 34, L = 6, R = 6;
  const t = (v: number) => (ax.log ? Math.log10(Math.max(v, 1)) : v);
  const a = t(ax.min), b = t(ax.max);
  const x = (v: number) => L + ((Math.min(Math.max(t(v), a), b) - a) / (b - a)) * (W - L - R);
  // Léger étalement vertical déterministe pour que les points ne se recouvrent pas tous.
  const dots = all.map((v, i) => `<circle cx="${f1(x(v))}" cy="${f1(17 + (((i * 37) % 11) - 5) * 1.6)}" r="1.7" class="sd"/>`).join('');
  const gm = groupMed != null ? `<line x1="${f1(x(groupMed))}" x2="${f1(x(groupMed))}" y1="4" y2="30" class="gm"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart strip" role="img">${dots}${gm}<circle cx="${f1(x(me))}" cy="17" r="6.5" fill="${color}" stroke="var(--bg)" stroke-width="2"/></svg>`;
}

/** Carte des votes : chaque député placé selon ses votes (deux premières composantes principales). */
export function mapPoints(pts: { x: number; y: number; s: string; n: string; g: string; c: string }[], opts: { highlight?: string; dim?: boolean } = {}): string {
  const W = 360, H = 280, P = 10;
  const X = (v: number) => P + ((v + 1) / 2) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v + 1) / 2) * (H - 2 * P);
  const body = pts
    .filter((p) => p.s !== opts.highlight)
    .map((p) => dot(X(p.x), Y(p.y), 2.6, p.c, { v: 0, s: p.s, n: p.n, g: p.g, label: p.g }, opts.dim ? ' fill-opacity=".35"' : ' fill-opacity=".85"'))
    .join('');
  const h = pts.find((p) => p.s === opts.highlight);
  const hi = h ? `<circle cx="${f1(X(h.x))}" cy="${f1(Y(h.y))}" r="8" fill="none" stroke="var(--ink)" stroke-width="2"/>${dot(X(h.x), Y(h.y), 4, h.c, { v: 0, s: h.s, n: h.n, g: h.g, label: h.g })}` : '';
  const axes = `<line x1="${P}" x2="${W - P}" y1="${f1(Y(0))}" y2="${f1(Y(0))}" class="grid"/><line x1="${f1(X(0))}" x2="${f1(X(0))}" y1="${P}" y2="${H - P}" class="grid"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart map" role="img" aria-label="Carte des votes des députés">${axes}${body}${hi}</svg>`;
}

/** Matrice d'accord entre groupes : une case par paire, couleur et pourcentage. */
export function matrix(labels: { sigle: string; color: string }[], rate: number[][], counts: number[][]): string {
  const n = labels.length, L = 50, T = 50, cell = (360 - L) / n;
  const W = L + n * cell, H = T + n * cell;
  let body = '';
  labels.forEach((a, i) => {
    body += `<text x="${L - 6}" y="${f1(T + i * cell + cell / 2 + 4)}" text-anchor="end" class="rl">${esc(a.sigle)}</text>`;
    body += `<text transform="translate(${f1(L + i * cell + cell / 2 + 4)} ${T - 6}) rotate(-60)" class="rl">${esc(a.sigle)}</text>`;
    labels.forEach((b, j) => {
      const v = rate[i][j];
      const t = Math.round(Math.max(0, (v - 0.2) / 0.8) * 100);
      const fill = i === j ? 'var(--ink-8)' : `color-mix(in srgb, var(--ramp-to) ${t}%, var(--ramp-from))`;
      body += `<rect x="${f1(L + j * cell + 0.75)}" y="${f1(T + i * cell + 0.75)}" width="${f1(cell - 1.5)}" height="${f1(cell - 1.5)}" rx="2" fill="${fill}" data-a="${esc(a.sigle)}" data-b="${esc(b.sigle)}" data-v="${Math.round(v * 100)}" data-k="${counts[i][j]}"/>`;
      if (i !== j) body += `<text x="${f1(L + j * cell + cell / 2)}" y="${f1(T + i * cell + cell / 2 + 3.5)}" text-anchor="middle" class="mv${t > 55 ? ' lt' : ''}">${Math.round(v * 100)}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${f1(W)} ${f1(H)}" class="chart matrix" role="img" aria-label="Part des scrutins où deux groupes ont voté de la même façon">${body}</svg>`;
}

/** Flux (Sankey) : types d'organisations à gauche, institutions visées à droite, épaisseur = nombre d'actions. */
export function sankey(left: { code: string; label: string }[], right: { code: string; label: string; color: string; n: number }[], flows: { de: string; vers: string; n: number }[]): string {
  const W = 360, L = 86, R = 104, nodeW = 8, gap = 7, T = 4;
  const tot = flows.reduce((a, f) => a + f.n, 0) || 1;
  const inner = 300;
  const k = (inner - gap * Math.max(left.length, right.length)) / tot;
  const sum = (code: string, side: 'de' | 'vers') => flows.filter((f) => f[side] === code).reduce((a, f) => a + f.n, 0);
  const place = (nodes: { code: string }[], side: 'de' | 'vers') => {
    let y = T;
    const out = new Map<string, { y: number; h: number; cur: number }>();
    for (const n of nodes) {
      const h = Math.max(2, sum(n.code, side) * k);
      out.set(n.code, { y, h, cur: y });
      y += h + gap;
    }
    return { out, H: y + T };
  };
  const lp = place(left, 'de'), rp = place(right, 'vers');
  const H = Math.max(lp.H, rp.H);
  const x0 = L + nodeW, x1 = W - R - nodeW, cx = (x0 + x1) / 2;
  const order = new Map(right.map((r, i) => [r.code, i]));
  const sorted = [...flows].filter((f) => f.n > 0).sort((a, b) => left.findIndex((l) => l.code === a.de) - left.findIndex((l) => l.code === b.de) || (order.get(a.vers)! - order.get(b.vers)!));
  const color = new Map(right.map((r) => [r.code, r.color]));
  let paths = '';
  for (const f of sorted) {
    const a = lp.out.get(f.de), b = rp.out.get(f.vers);
    if (!a || !b) continue;
    const h = f.n * k;
    const ya = a.cur + h / 2, yb = b.cur + h / 2;
    a.cur += h; b.cur += h;
    paths += `<path d="M${f1(x0)},${f1(ya)} C${f1(cx)},${f1(ya)} ${f1(cx)},${f1(yb)} ${f1(x1)},${f1(yb)}" stroke="${color.get(f.vers)}" stroke-width="${f1(Math.max(0.8, h))}" fill="none" stroke-opacity=".35" class="fl" data-inst="${f.vers}" data-fam="${f.de}"><title>${f.n.toLocaleString('fr-FR')}</title></path>`;
  }
  const ln = left.map((n) => { const p = lp.out.get(n.code)!; return `<g class="nd" data-fam="${n.code}"><rect x="${L}" y="${f1(p.y)}" width="${nodeW}" height="${f1(p.h)}" rx="2" fill="var(--ink)"/><text x="${L - 6}" y="${f1(p.y + p.h / 2 + 4)}" text-anchor="end" class="sl">${esc(n.label)}</text></g>`; }).join('');
  // Libellés de droite sur deux lignes : on les écarte d'au moins 25 px pour qu'ils ne se chevauchent pas.
  let last = -Infinity;
  const ly = right.map((n) => { const p = rp.out.get(n.code)!; const y = Math.max(p.y + p.h / 2 - 5, last + 25); last = y; return y; });
  const rn = right.map((n, i) => { const p = rp.out.get(n.code)!; return `<g class="nd" data-inst="${n.code}" role="button" tabindex="0" aria-label="${esc(n.label)} : ${n.n.toLocaleString('fr-FR')} actions"><rect x="${f1(x1)}" y="${f1(p.y)}" width="${nodeW}" height="${f1(p.h)}" rx="2" fill="${n.color}"/><rect x="${f1(x1)}" y="${f1(ly[i] - 10)}" width="${R + nodeW}" height="26" fill="transparent"/><text x="${f1(x1 + nodeW + 6)}" y="${f1(ly[i] + 1)}" class="sl">${esc(n.label)}</text><text x="${f1(x1 + nodeW + 6)}" y="${f1(ly[i] + 13)}" class="sv">${n.n.toLocaleString('fr-FR')}</text></g>`; }).join('');
  const H2 = Math.max(H, last + 20);
  return `<svg viewBox="0 0 ${W} ${f1(H2)}" class="chart sankey" role="group" aria-label="Actions de lobbying par type d'organisation et par institution visée">${paths}${ln}${rn}</svg>`;
}

/** Colonnes par trimestre. */
export function quarters(items: { t: string; n: number }[], H = 120): string {
  const W = 360, B = 18, T = 14, n = items.length || 1, bw = W / n;
  const max = Math.max(...items.map((i) => i.n), 1);
  const body = items
    .map((it, i) => {
      const h = (it.n / max) * (H - B - T);
      const lab = it.t.endsWith('T1') || i === 0 ? `<text x="${f1(i * bw + bw / 2)}" y="${H - 4}" text-anchor="middle" class="tk">${it.t.slice(0, 4)}</text>` : '';
      return `<rect x="${f1(i * bw + 2)}" y="${f1(H - B - h)}" width="${f1(bw - 4)}" height="${f1(h)}" rx="2" class="col"><title>${it.t} : ${it.n.toLocaleString('fr-FR')}</title></rect>${lab}`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Actions déclarées par trimestre">${body}</svg>`;
}
