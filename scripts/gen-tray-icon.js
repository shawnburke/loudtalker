// Generates 3 icon variants for the macOS menu-bar (tray) template icon:
//   normal   — bullhorn only
//   warning  — bullhorn + small filled triangle badge
//   limit    — bullhorn + large filled triangle badge
// Template images are pure black with an alpha mask; macOS tints them.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

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

function makePng(size, variant) {
  // variant: 'normal' | 'warning' | 'limit'
  const ss = 4; // supersample factor
  const sw = size * ss;
  const buf = new Float32Array(sw * sw);
  const cx = (sw - 1) / 2;
  const cy = (sw - 1) / 2;
  const r = sw / 2;

  // Bullhorn cone (trapezoid flaring right) — enlarged to fill the canvas
  const cone = [
    [cx + (-0.40) * r, cy + (-0.28) * r],
    [cx + (0.55) * r, cy + (-0.52) * r],
    [cx + (0.55) * r, cy + (0.52) * r],
    [cx + (-0.40) * r, cy + (0.28) * r],
  ];

  // Mouthpiece (rectangle on the left)
  const mouth = [
    [cx + (-0.75) * r, cy + (-0.16) * r],
    [cx + (-0.40) * r, cy + (-0.16) * r],
    [cx + (-0.40) * r, cy + (0.16) * r],
    [cx + (-0.75) * r, cy + (0.16) * r],
  ];

  const shapes = [cone, mouth];

  if (variant === 'warning' || variant === 'limit') {
    // Triangle badge
    const isLimit = variant === 'limit';
    const tri = [
      [cx + (0.25) * r, cy + (isLimit ? -0.70 : -0.58) * r],
      [cx + (-0.22) * r, cy + (isLimit ? -0.25 : -0.22) * r],
      [cx + (isLimit ? 0.62 : 0.50) * r, cy + (isLimit ? -0.25 : -0.22) * r],
    ];
    shapes.push(tri);
  }

  for (let y = 0; y < sw; y++) {
    for (let x = 0; x < sw; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (const poly of shapes) {
        if (pointInPolygon(px, py, poly)) { inside = true; break; }
      }
      buf[y * sw + x] = inside ? 255 : 0;
    }
  }

  // Downsample to target size
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
      raw[off] = 0;
      raw[off + 1] = 0;
      raw[off + 2] = 0;
      raw[off + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
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

const variants = ['normal', 'warning', 'limit'];
for (const v of variants) {
  const name = v === 'normal' ? 'trayTemplate' : `trayTemplate${v.charAt(0).toUpperCase() + v.slice(1)}`;
  fs.writeFileSync(path.join(dir, `${name}.png`), makePng(16, v));
  fs.writeFileSync(path.join(dir, `${name}@2x.png`), makePng(32, v));
  console.log(`wrote assets/${name}.png and @2x`);
}
