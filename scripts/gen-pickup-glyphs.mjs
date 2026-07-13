/**
 * Bake pickup icon outlines (Q/R/S + shield) for item.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';
import earcut from 'earcut';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'src/client/pickup-glyphs.js');

const FONT_CANDIDATES = [
  process.env.PICKUP_GLYPH_FONT,
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Bold.ttf',
  'C:\\Windows\\Fonts\\arialbd.ttf',
  'C:\\Windows\\Fonts\\Roboto-Bold.ttf',
].filter(Boolean);

function resolveLetterFontPath() {
  for (const candidate of FONT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const LETTERS = ['Q', 'R', 'S'];
const FONT_SIZE = 160;

function flatnessCubic(p0, p1, p2, p3) {
  const ux = 3 * p1[0] - 2 * p0[0] - p3[0];
  const uy = 3 * p1[1] - 2 * p0[1] - p3[1];
  const vx = 3 * p2[0] - 2 * p3[0] - p0[0];
  const vy = 3 * p2[1] - 2 * p3[1] - p0[1];
  return Math.max(
    Math.hypot(ux, uy),
    Math.hypot(vx, vy),
  );
}

function subdivideCubic(p0, p1, p2, p3, out, tol) {
  if (flatnessCubic(p0, p1, p2, p3) <= tol) {
    out.push(p3);
    return;
  }
  const m01 = mid(p0, p1);
  const m12 = mid(p1, p2);
  const m23 = mid(p2, p3);
  const m012 = mid(m01, m12);
  const m123 = mid(m12, m23);
  const m = mid(m012, m123);
  subdivideCubic(p0, m01, m012, m, out, tol);
  subdivideCubic(m, m123, m23, p3, out, tol);
}

function subdivideQuad(p0, p1, p2, out, tol) {
  const c1 = mid(p0, p1);
  const c2 = mid(p1, p2);
  subdivideCubic(p0, c1, c2, p2, out, tol);
}

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function commandsToContours(commands, tol = 0.35) {
  const contours = [];
  let current = null;
  let cur = [0, 0];

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (current && current.length > 2) contours.push(current);
        current = [[cmd.x, cmd.y]];
        cur = [cmd.x, cmd.y];
        break;
      case 'L':
        current.push([cmd.x, cmd.y]);
        cur = [cmd.x, cmd.y];
        break;
      case 'C':
        subdivideCubic(cur, [cmd.x1, cmd.y1], [cmd.x2, cmd.y2], [cmd.x, cmd.y], current, tol);
        cur = [cmd.x, cmd.y];
        break;
      case 'Q':
        subdivideQuad(cur, [cmd.x1, cmd.y1], [cmd.x, cmd.y], current, tol);
        cur = [cmd.x, cmd.y];
        break;
      case 'Z':
        if (current && current.length > 2) contours.push(current);
        current = null;
        break;
      default:
        break;
    }
  }
  if (current && current.length > 2) contours.push(current);
  return contours;
}

function signedArea(contour) {
  let a = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i];
    const q = contour[(i + 1) % contour.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

function centroid(contour) {
  let x = 0;
  let y = 0;
  for (const p of contour) {
    x += p[0];
    y += p[1];
  }
  const n = contour.length || 1;
  return [x / n, y / n];
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function normalizeContours(contours) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 1 / span;
  return contours.map((c) =>
    c.map((p) => [(p[0] - cx) * scale, (p[1] - cy) * scale]),
  );
}

function flipTrianglesY(tris) {
  return tris.map((tri) => tri.map((p) => [p[0], -p[1]]));
}

function triangulateContours(contours) {
  if (!contours.length) return [];
  const ranked = contours
    .map((c) => ({ c, area: signedArea(c), cen: centroid(c) }))
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

  const outers = ranked.filter((r) => r.area > 0);
  const holes = ranked.filter((r) => r.area < 0);
  const tris = [];

  for (const outer of outers.length ? outers : [ranked[0]]) {
    const innerHoles = holes.filter((h) => pointInPoly(h.cen, outer.c));
    const flat = [];
    const holeIdx = [];
    for (const p of outer.c) flat.push(p[0], p[1]);
    for (const h of innerHoles) {
      holeIdx.push(flat.length / 2);
      for (const p of h.c) flat.push(p[0], p[1]);
    }
    const idx = earcut(flat, holeIdx);
    for (let i = 0; i < idx.length; i += 3) {
      tris.push([
        [flat[idx[i] * 2], flat[idx[i] * 2 + 1]],
        [flat[idx[i + 1] * 2], flat[idx[i + 1] * 2 + 1]],
        [flat[idx[i + 2] * 2], flat[idx[i + 2] * 2 + 1]],
      ]);
    }
  }
  return tris;
}

function glyphTriangles(font, ch) {
  const glyph = font.charToGlyph(ch);
  const path = glyph.getPath(0, 0, FONT_SIZE);
  const contours = normalizeContours(commandsToContours(path.commands));
  return flipTrianglesY(triangulateContours(contours));
}

function simpleShieldTriangles() {
  const p = (x, y) => [x, y];
  const top = p(0, 0.5);
  const tl = p(-0.42, 0.42);
  const tr = p(0.42, 0.42);
  const ml = p(-0.45, 0.05);
  const mr = p(0.45, 0.05);
  const bl = p(-0.32, -0.38);
  const br = p(0.32, -0.38);
  const bot = p(0, -0.5);
  return [
    [top, tr, mr],
    [top, mr, ml],
    [top, ml, tl],
    [tl, ml, bl],
    [tr, br, mr],
    [ml, mr, bl],
    [mr, br, bl],
    [bl, br, bot],
  ];
}

const letterFontPath = resolveLetterFontPath();
if (!letterFontPath) {
  if (fs.existsSync(outPath)) {
    console.log('No system TTF for pickup glyphs; keeping', outPath);
    process.exit(0);
  }
  throw new Error(
    'No bold TTF found for pickup glyph generation. Set PICKUP_GLYPH_FONT or commit pickup-glyphs.js.',
  );
}

console.log('Pickup glyph font:', letterFontPath);
const letterFont = opentype.parse(fs.readFileSync(letterFontPath));
const baked = {};
for (const ch of LETTERS) {
  baked[ch] = glyphTriangles(letterFont, ch);
  console.log(ch, 'triangles', baked[ch].length);
}
baked.shield = simpleShieldTriangles();
console.log('shield', 'triangles', baked.shield.length);

const body = `// Auto-generated by scripts/gen-pickup-glyphs.mjs — do not edit by hand.
// Letters: system bold TTF (Roboto/Inter/Arial/DejaVu via PICKUP_GLYPH_FONT or OS paths)
// Shield: low-poly outline (not Font Awesome — too dense for wire mode)

export const PICKUP_GLYPH_TRIANGLES = ${JSON.stringify(baked, null, 2)};
`;

fs.writeFileSync(outPath, body);
console.log('Wrote', outPath);
