/**
 * Build script for Trinity Chrome Extension
 * Packages the extension for loading into Chrome
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Files to copy from src to dist
const filesToCopy = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'background.js',
  'demo.html',
];

filesToCopy.forEach(file => {
  const srcPath = path.join(srcDir, file);
  const distPath = path.join(distDir, file);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, distPath);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
});

// Bundle skeleton-transpiler.js into content.js
const transpilerPath = path.join(srcDir, 'skeleton-transpiler.js');
const contentPath = path.join(srcDir, 'content.js');
const distContentPath = path.join(distDir, 'content.js');

if (fs.existsSync(transpilerPath) && fs.existsSync(contentPath)) {
  const transpilerCode = fs.readFileSync(transpilerPath, 'utf8');
  const contentCode = fs.readFileSync(contentPath, 'utf8');
  const bundledCode = transpilerCode + '\n' + contentCode;
  fs.writeFileSync(distContentPath, bundledCode);
  console.log('Bundled: content.js + skeleton-transpiler.js');
} else {
  console.warn('Warning: skeleton-transpiler.js or content.js not found');
}

// Create icons directory and placeholder icons
const iconsDir = path.join(distDir, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Create simple solid color icons
[16, 48, 128].forEach(size => {
  const iconPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(iconPath, createSimpleIcon(size));
  console.log(`Created icon: icon${size}.png`);
});

console.log('\nBuild complete! To load the extension:');
console.log('1. Open Chrome and go to chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked"');
console.log(`4. Select the "${distDir}" directory`);

function createSimpleIcon(size) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(2, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdr = createPNGChunk('IHDR', ihdrData);

  // Raw image data - solid blue color (#3b82f6)
  const rawData = Buffer.alloc(size * (size * 3 + 1));
  const r = 0x3b, g = 0x82, b = 0xf6;

  for (let y = 0; y < size; y++) {
    rawData[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idat = createPNGChunk('IDAT', compressedData);
  const iend = createPNGChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSignature, ihdr, idat, iend]);
}

function createPNGChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  const table = makeCRCTable();

  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeCRCTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}
