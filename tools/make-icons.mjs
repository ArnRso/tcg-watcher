import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, pixel) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const at = row + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const mix = (a, b, t) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));

const TOP = [99, 102, 241];
const BOTTOM = [67, 56, 202];
const FOIL = [250, 250, 255];
const SPARK = [253, 224, 71];

function icon(x, y, size) {
  const unit = size / 16;
  const cx = (x + 0.5) / size;
  const cy = (y + 0.5) / size;

  // Coin arrondi du fond
  const radius = 3.2 * unit;
  const dx = Math.max(radius - (x + 0.5), 0, (x + 0.5) - (size - radius));
  const dy = Math.max(radius - (y + 0.5), 0, (y + 0.5) - (size - radius));
  if (Math.hypot(dx, dy) > radius) return [0, 0, 0, 0];

  let color = mix(TOP, BOTTOM, cy);

  // Carte inclinée au centre : bande claire façon booster
  const rx = cx - 0.5;
  const ry = cy - 0.5;
  const rot = -0.28;
  const px = rx * Math.cos(rot) - ry * Math.sin(rot);
  const py = rx * Math.sin(rot) + ry * Math.cos(rot);

  if (Math.abs(px) < 0.155 && Math.abs(py) < 0.27) {
    const edge = Math.abs(px) > 0.125 || Math.abs(py) > 0.24;
    color = edge ? mix(FOIL, BOTTOM, 0.45) : FOIL;

    // Encoche de déchirure en haut de la carte
    if (py < -0.185 && Math.abs(px) < 0.125) {
      color = mix(FOIL, SPARK, 0.75);
    }
  }

  return [...color, 255];
}

mkdirSync(resolve(root, 'icons'), { recursive: true });
for (const size of SIZES) {
  const file = resolve(root, `icons/icon${size}.png`);
  writeFileSync(file, png(size, icon));
  console.log(`icons/icon${size}.png`);
}
