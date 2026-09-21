#!/usr/bin/env node
/**
 * verify-images.mjs — Kiểm tra mọi PNG có kích thước đúng = kích thước node (không 1×1)
 * 
 * Đọc nodes.json + thư mục images/, in bảng nodeId · kích thước node · kích thước PNG · OK/LỖI
 * exit 1 nếu có PNG 1×1 hoặc ảnh thiếu.
 * 
 * Chạy:
 *   node verify-images.mjs [nodes.json] [imagesDir]
 *   node verify-images.mjs                          // mặc định poc2
 *   node verify-images.mjs /tmp/export-check/nodes.json /tmp/export-check/images
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PNG } = require('/Downloads/poki/pokiwar-web/node_modules/pngjs');

const DEFAULT_NODES = '/Downloads/poki/pokiwar-web/public/game/poc2/nodes.json';
const DEFAULT_IMAGES = '/Downloads/poki/pokiwar-web/public/game/poc2/images';

const nodesPath = process.argv[2] || DEFAULT_NODES;
const imagesDir = process.argv[3] || DEFAULT_IMAGES;

if (!fs.existsSync(nodesPath)) {
  console.error(`[verify-images] Không tìm thấy nodes.json: ${nodesPath}`);
  process.exit(2);
}
if (!fs.existsSync(imagesDir)) {
  console.error(`[verify-images] Không tìm thấy imagesDir: ${imagesDir}`);
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
const nodes = raw.nodes || raw.flattenLayers || [];
const withImage = nodes.filter(n => n.imageRef);

console.log('='.repeat(90));
console.log(`VERIFY IMAGES: ${nodesPath} → ${imagesDir}`);
console.log(`Tổng node: ${nodes.length} · có imageRef: ${withImage.length}`);
console.log('='.repeat(90));
console.log(`| ${'nodeId'.padEnd(10)} | ${'name'.padEnd(22)} | ${'node W×H'.padEnd(12)} | ${'PNG W×H'.padEnd(10)} | ${'bytes'.padEnd(6)} | Kết quả |`);
console.log('-'.repeat(90));

let okCount = 0;
let failCount = 0;
let failList = [];

for (const n of withImage) {
  const key = n.imageRef;
  const file = path.join(imagesDir, `${key}.png`);
  const w = Math.round(n.width || 0);
  const h = Math.round(n.height || 0);
  const nodeSize = `${w}×${h}`;
  if (!fs.existsSync(file)) {
    console.log(`| ${String(n.id).padEnd(10)} | ${String(n.name||'').slice(0,22).padEnd(22)} | ${nodeSize.padEnd(12)} | ${'MISSING'.padEnd(10)} | ${'-'.padEnd(6)} | ❌ THIẾU |`);
    failCount++; failList.push(`${n.id} MISSING`);
    continue;
  }
  const data = fs.readFileSync(file);
  let png;
  try { png = PNG.sync.read(data); } catch (e) {
    console.log(`| ${String(n.id).padEnd(10)} | ${String(n.name||'').slice(0,22).padEnd(22)} | ${nodeSize.padEnd(12)} | ${'ERR'.padEnd(10)} | ${String(data.length).padEnd(6)} | ❌ LỖI |`);
    failCount++; failList.push(`${n.id} ERR ${e.message}`);
    continue;
  }
  const pngSize = `${png.width}×${png.height}`;
  const isOk = png.width > 1 && png.height > 1 && png.width === w && png.height === h ? '✅ OK' : (png.width > 1 && png.height > 1 ? '✅ OK*' : '❌ 1×1');
  // * = kích thước PNG khác node nhưng vẫn >1 (chấp nhận, chỉ chặn 1×1 theo yêu cầu)
  // Yêu cầu nhiệm vụ: assert width>1 && height>1 ; không bắt buộc khớp tuyệt đối
  const strictlyOk = png.width > 1 && png.height > 1;
  if (strictlyOk) okCount++; else { failCount++; failList.push(`${n.id} ${n.name} node ${nodeSize} → PNG ${pngSize} bytes ${data.length}`); }
  const result = strictlyOk ? (png.width===w && png.height===h ? '✅ OK' : '✅ OK*') : '❌ 1×1';
  console.log(`| ${String(n.id).padEnd(10)} | ${String(n.name||'').slice(0,22).padEnd(22)} | ${nodeSize.padEnd(12)} | ${pngSize.padEnd(10)} | ${String(data.length).padEnd(6)} | ${result} |`);
}

console.log('-'.repeat(90));
console.log(`OK: ${okCount} / ${withImage.length} · LỖI (1×1/thiếu): ${failCount}`);
if (failList.length > 0) {
  console.log('\nDanh sách LỖI (10 đầu):');
  for (const f of failList.slice(0,10)) console.log(' -', f);
  if (failList.length > 10) console.log(` ... và ${failList.length-10} file nữa`);
}
console.log('='.repeat(90));

if (failCount > 0) {
  console.error(`[verify-images] FAIL: ${failCount} ảnh 1×1/thiếu — cần export lại với plugin đã sửa (tạm bật tổ tiên ẩn trước khi exportAsync)`);
  process.exit(1);
} else {
  console.log('[verify-images] PASS: mọi PNG đều có width>1 && height>1');
  process.exit(0);
}
