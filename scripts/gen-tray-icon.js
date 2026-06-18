// Generates a simple monochrome circle PNG used as the macOS menu-bar (tray)
// template icon, at 1x (16px) and 2x (32px). Template images are pure black
// with an alpha mask; macOS tints them for light/dark menu bars.
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

function makePng(size) {
  const w = size;
  const h = size;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rOuter = w * 0.46;
  const rInner = w * 0.42;
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const off = y * stride + 1 + x * 4;
      const d = Math.hypot(x - cx, y - cy);
      // Anti-aliased filled disc.
      let a = 0;
      if (d <= rInner) a = 255;
      else if (d <= rOuter) a = Math.round(255 * (1 - (d - rInner) / (rOuter - rInner)));
      raw[off] = 0;
      raw[off + 1] = 0;
      raw[off + 2] = 0;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
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
fs.writeFileSync(path.join(dir, 'trayTemplate.png'), makePng(16));
fs.writeFileSync(path.join(dir, 'trayTemplate@2x.png'), makePng(32));
console.log('wrote assets/trayTemplate.png and @2x');
