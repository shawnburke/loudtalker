// Generates macOS menu-bar tray icons for the 3 Loud Talker states:
//   normal   — bullhorn glyph only (template image, macOS tints it)
//   warning  — yellow badge + dark glyph
//   alert    — red badge + white glyph
//
// The bullhorn glyph is from the design SVGs, rendered via supersampled
// point-in-polygon rasterization.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- Geometry helpers ----

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// Quadratic bezier: B(t) = (1-t)^2*P0 + 2(1-t)*t*P1 + t^2*P2
function quadBezierPoints(p0, p1, p2, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return pts;
}

// Thick stroke strip around a polyline
function strokeStrip(pts, r) {
  const strip = [];
  const normals = [];
  for (let i = 0; i < pts.length; i++) {
    const dx = i === pts.length - 1 ? pts[i][0] - pts[i - 1][0] : pts[i + 1][0] - pts[i][0];
    const dy = i === pts.length - 1 ? pts[i][1] - pts[i - 1][1] : pts[i + 1][1] - pts[i][1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    normals.push([-dy / len * r, dx / len * r]);
  }
  for (let i = pts.length - 1; i >= 0; i--) strip.push([pts[i][0] + normals[i][0], pts[i][1] + normals[i][1]]);
  for (let i = 0; i < pts.length; i++) strip.push([pts[i][0] - normals[i][0], pts[i][1] - normals[i][1]]);
  return strip;
}

// ---- Icon generation ----

const VW = 36; // design viewport width
const VH = 36;

// Badge
const badge = [
  [1.5, 1.5],
  [34.5, 1.5],
  [34.5, 34.5],
  [1.5, 34.5],
]; // clipped by rx below

function inBadge(x, y) {
  const rx = 9, ry = 9;
  const l = 1.5, r = 34.5, t = 1.5, b = 34.5;
  if (x < l || x > r || y < t || y > b) return false;
  if (x < l + rx && y < t + ry) return (x - l - rx) * (x - l - rx) + (y - t - ry) * (y - t - ry) <= rx * rx;
  if (x > r - rx && y < t + ry) return (x - r + rx) * (x - r + rx) + (y - t - ry) * (y - t - ry) <= rx * rx;
  if (x < l + rx && y > b - ry) return (x - l - rx) * (x - l - rx) + (y - b + ry) * (y - b + ry) <= rx * rx;
  if (x > r - rx && y > b - ry) return (x - r + rx) * (x - r + rx) + (y - b + ry) * (y - b + ry) <= rx * rx;
  return true;
}

// Glyph paths in the scaled 36x36 viewport
// The design SVGs use: transform="translate(8.2 8.2) scale(0.7)"
// So we apply the inverse for rendering: our coords are in the 36x36 space
const S = 0.7;
const TX = 8.2;
const TY = 8.2;

function gx(x) { return x * S + TX; }
function gy(y) { return y * S + TY; }

// Horn cone (polygon)
const horn = [
  [6, 11], [15, 6], [15, 22], [6, 17],
].map(p => [gx(p[0]), gy(p[1])]);

// Mouthpiece (rectangle with rounded corners approximated as rect)
const mouth = [
  [3.2, 11], [6.4, 11], [6.4, 17], [3.2, 17],
].map(p => [gx(p[0]), gy(p[1])]);
function inMouth(x, y) {
  const l = gx(3.2), r = gx(6.4), t = gy(11), b = gy(17);
  return x >= l && x <= r && y >= t && y <= b;
}

// Handle (parallelogram)
const handle = [
  [8.6, 17], [11.4, 17], [10.7, 22.6], [9.3, 22.6],
].map(p => [gx(p[0]), gy(p[1])]);

// Sound arcs — quadratic beziers with stroke width ~1.7 (in glyph space)
function makeArc(pts) {
  const scaled = pts.map(p => [gx(p[0]), gy(p[1])]);
  const samples = quadBezierPoints(...scaled, 16);
  return strokeStrip(samples, 0.7); // approx stroke width in output space
}

// M17 9 Q20.4 14 17 19
const arc1 = makeArc([[17, 9], [20.4, 14], [17, 19]]);
// M19.6 7.2 Q24 14 19.6 20.8
const arc2 = makeArc([[19.6, 7.2], [24, 14], [19.6, 20.8]]);

const glyphPolys = [horn, mouth, handle, arc1, arc2];

function inGlyph(x, y) {
  for (const poly of glyphPolys) {
    if (poly === mouth) { if (inMouth(x, y)) return true; continue; }
    if (pointInPolygon(x, y, poly)) return true;
  }
  return false;
}

// ---- PNG generation ----

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size, variant) {
  // variant: 'template' | 'warning' | 'alert'
  const ss = 4;
  const sw = size * ss;
  const buf = new Float32Array(sw * sw);

  for (let y = 0; y < sw; y++) {
    for (let x = 0; x < sw; x++) {
      const px = (x + 0.5) * (VW / sw);
      const py = (y + 0.5) * (VH / sw);

      const inBad = inBadge(px, py);
      const inGl = inGlyph(px, py);

      if (variant === 'template') {
        // Pure black glyph on transparent — macOS tints the whole thing
        buf[y * sw + x] = inGl ? 255 : 0;
      } else if (variant === 'warning') {
        // Yellow badge (#e8b931) with dark glyph (#1a1606)
        if (inGl) buf[y * sw + x] = 255; // glyph — full opacity (black in template terms)
        else if (inBad) buf[y * sw + x] = 255; // badge — also opaque (yellow)
        // else transparent
      } else { // alert
        // Red badge (#ef4444) with white glyph (#ffffff)
        if (inGl) buf[y * sw + x] = 255; // glyph
        else if (inBad) buf[y * sw + x] = 255; // badge
      }
    }
  }

  const w = size, h = size;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);

  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++)
          sum += buf[(y * ss + sy) * sw + (x * ss + sx)];

      const a = Math.round(sum / (ss * ss));
      const off = y * stride + 1 + x * 4;

      if (variant === 'template') {
        raw[off] = 0;
        raw[off + 1] = 0;
        raw[off + 2] = 0;
      } else if (variant === 'warning') {
        // #e8b931 → R=232 G=185 B=49
        raw[off] = 232;
        raw[off + 1] = 185;
        raw[off + 2] = 49;
      } else { // alert
        // #ef4444 → R=239 G=68 B=68
        raw[off] = 239;
        raw[off + 1] = 68;
        raw[off + 2] = 68;
      }
      raw[off + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });

const variants = [
  { id: 'normal', file: 'trayTemplate', type: 'template' },
  { id: 'warning', file: 'trayTemplateWarning', type: 'warning' },
  { id: 'alert', file: 'trayTemplateLimit', type: 'alert' },
];

for (const v of variants) {
  fs.writeFileSync(path.join(dir, `${v.file}.png`), makePng(16, v.type));
  fs.writeFileSync(path.join(dir, `${v.file}@2x.png`), makePng(32, v.type));
  console.log(`wrote assets/${v.file}.png and @2x (${v.type})`);
}
