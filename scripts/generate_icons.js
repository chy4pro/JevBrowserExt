import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createLightningPng(size) {
  // Simple uncompressed/deflated raw RGBA buffer
  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      // Rounded background box with indigo (#4f46e5) and gold bolt (#fbbf24)
      const cx = width / 2;
      const cy = height / 2;
      const r = width * 0.45;
      const dist = Math.hypot(x - cx, y - cy);

      // Gradient background
      if (dist <= r) {
        // Draw lightning bolt shape roughly
        const nx = x / width;
        const ny = y / height;
        const inBolt =
          (ny > 0.2 && ny < 0.55 && nx > 0.45 - (ny - 0.2) * 0.3 && nx < 0.65 - (ny - 0.2) * 0.2) ||
          (ny >= 0.45 && ny < 0.8 && nx > 0.35 + (ny - 0.45) * 0.2 && nx < 0.55 + (ny - 0.45) * 0.3);

        if (inBolt) {
          rawData[offset++] = 251; // R (gold)
          rawData[offset++] = 191; // G
          rawData[offset++] = 36;  // B
          rawData[offset++] = 255; // A
        } else {
          rawData[offset++] = 79;  // R (indigo)
          rawData[offset++] = 70;  // G
          rawData[offset++] = 229; // B
          rawData[offset++] = 255; // A
        }
      } else {
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0; // Transparent
      }
    }
  }

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // Color type: RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT chunk
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crcVal = crc32(chunk.subarray(4, 8 + len));
  chunk.writeInt32BE(crcVal, 8 + len);
  return chunk;
}

// Standard CRC32 table
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ -1;
}

const publicDir = path.resolve(__dirname, '../public');
for (const size of [16, 48, 128]) {
  const png = createLightningPng(size);
  fs.writeFileSync(path.join(publicDir, `icon${size}.png`), png);
}
console.log('Icons generated successfully!');
