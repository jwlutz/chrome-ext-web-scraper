// Generate placeholder icon PNGs for the extension
// These are simple colored squares - replace with real icons later

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '../extension/icons');

// Ensure icons directory exists
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

// CRC32 calculation for PNG chunks
function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = [];

  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }

  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 0);
  return result;
}

function uint32BE(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n, 0);
  return buf;
}

function createSimplePNG(size, r, g, b) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(2, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdrCRC = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdr = Buffer.concat([
    uint32BE(13),
    Buffer.from('IHDR'),
    ihdrData,
    ihdrCRC
  ]);

  // Raw pixel data
  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0);
    for (let x = 0; x < size; x++) {
      rawData.push(r, g, b);
    }
  }

  const compressed = deflateSync(Buffer.from(rawData));
  const idatCRC = crc32(Buffer.concat([Buffer.from('IDAT'), compressed]));
  const idat = Buffer.concat([
    uint32BE(compressed.length),
    Buffer.from('IDAT'),
    compressed,
    idatCRC
  ]);

  // IEND
  const iendCRC = crc32(Buffer.from('IEND'));
  const iend = Buffer.concat([
    uint32BE(0),
    Buffer.from('IEND'),
    iendCRC
  ]);

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Generate icons - solid purple squares (#6366f1)
const sizes = [16, 48, 128];
const color = { r: 99, g: 102, b: 241 };

for (const size of sizes) {
  const png = createSimplePNG(size, color.r, color.g, color.b);
  const path = resolve(iconsDir, `icon${size}.png`);
  writeFileSync(path, png);
  console.log(`Created ${path}`);
}

console.log('Icons generated successfully!');
