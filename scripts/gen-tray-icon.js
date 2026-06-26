// Generates macOS menu-bar tray icons for the 3 Loud Talker states:
//   normal   — bullhorn glyph, larger, as template image (macOS tints it)
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

const VW = 36;
const VH = 36;

// Badge (rounded rect, used by warning/alert)
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

// Badge border: strip 0.8px inside the badge edge
function inBadgeBorder(x, y) {
  const bw = 0.8;
  if (!inBadge(x, y)) return false;
  // A pixel is on the border if we can move bw inward and leave the badge
  const cx = x, cy = y;
  const inward = bw * 0.707; // diagonal component
  // Check 4 diagonal directions — if any exits the badge, we're near the edge
  const dirs = [[inward, 0], [-inward, 0], [0, inward], [0, -inward]];
  for (const [dx, dy] of dirs) {
    if (!inBadge(cx + dx, cy + dy)) return true;
  }
  return false;
}

// ---- Glyph paths for badge (smaller, inside badge) ----
// The design SVGs use: transform="translate(8.2 8.2) scale(0.7)"
const S = 0.7;
const TX = 8.2;
const TY = 8.2;

function bgx(x) { return x * S + TX; }
function bgy(y) { return y * S + TY; }

function badgeGlyphPaths() {
  const gx = bgx, gy = bgy;
  const horn = [[6, 11], [15, 6], [15, 22], [6, 17]].map(p => [gx(p[0]), gy(p[1])]);
  const mouth = [[3.2, 11], [6.4, 11], [6.4, 17], [3.2, 17]].map(p => [gx(p[0]), gy(p[1])]);
  function inMouth(x, y) {
    const l = gx(3.2), r = gx(6.4), t = gy(11), b = gy(17);
    return x >= l && x <= r && y >= t && y <= b;
  }
  const handle = [[8.6, 17], [11.4, 17], [10.7, 22.6], [9.3, 22.6]].map(p => [gx(p[0]), gy(p[1])]);
  function makeArc(pts) {
    const scaled = pts.map(p => [gx(p[0]), gy(p[1])]);
    const samples = quadBezierPoints(...scaled, 16);
    return strokeStrip(samples, 0.7);
  }
  const arc1 = makeArc([[17, 9], [20.4, 14], [17, 19]]);
  const arc2 = makeArc([[19.6, 7.2], [24, 14], [19.6, 20.8]]);
  const polys = [horn, mouth, handle, arc1, arc2];
  return { polys, inMouth };
}

const badgeGlyph = badgeGlyphPaths();

function inBadgeGlyph(x, y) {
  for (const poly of badgeGlyph.polys) {
    if (poly === badgeGlyph.polys[1]) { if (badgeGlyph.inMouth(x, y)) return true; continue; }
    if (pointInPolygon(x, y, poly)) return true;
  }
  return false;
}

// ---- Glyph paths for template (larger, fills canvas) ----
// Scale to fill ~28px of the 36px viewport
const TS = 1.26;
const TTX = 0.86;
const TTY = -0.77;

function tgx(x) { return x * TS + TTX; }
function tgy(y) { return y * TS + TTY; }

function templateGlyphPaths() {
  const gx = tgx, gy = tgy;
  const horn = [[6, 11], [15, 6], [15, 22], [6, 17]].map(p => [gx(p[0]), gy(p[1])]);
  const mouth = [[3.2, 11], [6.4, 11], [6.4, 17], [3.2, 17]].map(p => [gx(p[0]), gy(p[1])]);
  function inMouth(x, y) {
    const l = gx(3.2), r = gx(6.4), t = gy(11), b = gy(17);
    return x >= l && x <= r && y >= t && y <= b;
  }
  const handle = [[8.6, 17], [11.4, 17], [10.7, 22.6], [9.3, 22.6]].map(p => [gx(p[0]), gy(p[1])]);
  function makeArc(pts) {
    const scaled = pts.map(p => [gx(p[0]), gy(p[1])]);
    const samples = quadBezierPoints(...scaled, 16);
    return strokeStrip(samples, 0.7 * (TS / S)); // adjust stroke for scale
  }
  const arc1 = makeArc([[17, 9], [20.4, 14], [17, 19]]);
  const arc2 = makeArc([[19.6, 7.2], [24, 14], [19.6, 20.8]]);
  const polys = [horn, mouth, handle, arc1, arc2];
  return { polys, inMouth };
}

const templateGlyph = templateGlyphPaths();

function inTemplateGlyph(x, y) {
  for (const poly of templateGlyph.polys) {
    if (poly === templateGlyph.polys[1]) { if (templateGlyph.inMouth(x, y)) return true; continue; }
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

function makeDockPng(size) {
  const sw = size;
  const buf = new Float32Array(sw * sw);
  const glyphBuf = new Float32Array(sw * sw);

  for (let y = 0; y < sw; y++) {
    for (let x = 0; x < sw; x++) {
      const px = (x + 0.5) * (VW / sw);
      const py = (y + 0.5) * (VH / sw);
      const inBad = inBadge(px, py);
      const inGl = inBadgeGlyph(px, py);
      buf[y * sw + x] = (inBad || inGl) ? 255 : 0;
      glyphBuf[y * sw + x] = inGl ? 255 : 0;
    }
  }

  const w = size, h = size;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);

  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const v = buf[y * w + x];
      const g = glyphBuf[y * w + x];
      const off = y * stride + 1 + x * 4;
      if (g > 0) {
        raw[off] = 26; raw[off + 1] = 22; raw[off + 2] = 6;
      } else {
        raw[off] = 232; raw[off + 1] = 185; raw[off + 2] = 49;
      }
      raw[off + 3] = Math.round(v);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
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

      if (variant === 'template') {
        // Glyph only — macOS tints all non-transparent pixels as template image
        buf[y * sw + x] = inTemplateGlyph(px, py) ? 255 : 0;
      } else {
        // Badge + smaller glyph
        const inBad = inBadge(px, py);
        const inGl = inBadgeGlyph(px, py);
        if (inGl) {
          buf[y * sw + x] = 255; // glyph — opaque
        } else if (inBad) {
          // Badge fill: semi-transparent (lighter in menu bar)
          const onBorder = inBadgeBorder(px, py);
          buf[y * sw + x] = onBorder ? 255 : 160;
        }
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
        raw[off] = 0; raw[off + 1] = 0; raw[off + 2] = 0;
      } else if (variant === 'warning') {
        raw[off] = 232; raw[off + 1] = 185; raw[off + 2] = 49;
      } else {
        raw[off] = 239; raw[off + 1] = 68; raw[off + 2] = 68;
      }
      raw[off + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
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

console.log('generating dock icon...');
fs.writeFileSync(path.join(dir, 'appIcon.png'), makeDockPng(512));
console.log('wrote assets/appIcon.png');
