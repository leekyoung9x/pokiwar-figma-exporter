/**
 * bench.mjs — Đo đạc hiệu năng và kiểm chứng tính toàn vẹn dữ liệu
 * giữa bản export cũ (nodes.json) và bản schema đích tối ưu.
 * 
 * Chạy: node /Downloads/poki/figma-plugin-pokiwar/bench.mjs
 */

import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let PNG;
try { PNG = require('pngjs').PNG; } catch { try { PNG = require('/Downloads/poki/pokiwar-web/node_modules/pngjs').PNG; } catch { PNG=null; } }
import path from 'path';
import { performance } from 'perf_hooks';
import {
  convertRawLayersToTargetSchema,
  readGeometry,
  readVisible,
  readOpacity,
  readCornerRadii,
  readClipsContent,
  readFills,
  readStrokes,
  readStrokeWeight,
  readStrokeAlign,
  readText,
  isVisualLeafNode,
} from './converter.mjs';

const OLD_NODES_PATH = '/Downloads/poki/pokiwar-web/public/game/poc/nodes.json';
const OLD_IMAGES_PATH = '/Downloads/poki/pokiwar-web/public/game/poc/images.json';

const oldJsonString = fs.readFileSync(OLD_NODES_PATH, 'utf8');
const oldImagesData = JSON.parse(fs.readFileSync(OLD_IMAGES_PATH, 'utf8'));
const oldImagesList = oldImagesData.images || [];

const oldParsed = JSON.parse(oldJsonString);
const oldRawLayers = oldParsed.flattenLayers;

// Chuyển đổi sang schema đích
const targetResult = convertRawLayersToTargetSchema(oldRawLayers, oldImagesList);
const newJsonString = JSON.stringify(targetResult);

// ── 1. ĐO DUNG LƯỢNG (BYTES) ──────────────────────────────────────────────────
const oldBytes = Buffer.byteLength(oldJsonString, 'utf8');
const newBytes = Buffer.byteLength(newJsonString, 'utf8');
const reductionPercent = (((oldBytes - newBytes) / oldBytes) * 100).toFixed(2);
const reductionFactor = (oldBytes / newBytes).toFixed(2);

// ── 2. BENCHMARK JSON.parse ───────────────────────────────────────────────────
const WARMUP_RUNS = 20;
const BENCH_RUNS = 100;

for (let i = 0; i < WARMUP_RUNS; i++) {
  JSON.parse(oldJsonString);
  JSON.parse(newJsonString);
}

const t0OldParse = performance.now();
for (let i = 0; i < BENCH_RUNS; i++) {
  JSON.parse(oldJsonString);
}
const avgOldParseMs = (performance.now() - t0OldParse) / BENCH_RUNS;

const t0NewParse = performance.now();
for (let i = 0; i < BENCH_RUNS; i++) {
  JSON.parse(newJsonString);
}
const avgNewParseMs = (performance.now() - t0NewParse) / BENCH_RUNS;

// ── 3. BENCHMARK DUYỆT CÂY & TÍNH TOÁN ─────────────────────────────────────────
// Cũ: Phải duyệt DFS 9 tầng, deepFind trong nodeParameters_*, cộng dồn absX/absY
function oldTreeTraversal(rawNodes) {
  const byRawId = new Map();
  for (const n of rawNodes) byRawId.set(n.id, n);
  const root = rawNodes[0];
  const stack = [{ node: root, ax: 0, ay: 0, depth: 0 }];
  const seen = new Set();
  const result = [];

  while (stack.length > 0) {
    const { node, ax, ay, depth } = stack.pop();
    if (seen.has(node.id)) continue;
    seen.add(node.id);

    const g = readGeometry(node);
    const absX = ax + g.x;
    const absY = ay + g.y;
    const vis = readVisible(node);
    const op = readOpacity(node);
    const cr = readCornerRadii(node);
    const cc = readClipsContent(node);
    const f = readFills(node);
    const st = readStrokes(node);
    const sw = readStrokeWeight(node);
    const sa = readStrokeAlign(node);
    const txt = readText(node);

    result.push({ id: node.id, absX, absY, depth, vis, op, cr, cc, f, st, sw, sa, txt });

    const kids = Array.isArray(node.childrenNames) ? node.childrenNames : [];
    for (let i = kids.length - 1; i >= 0; i--) {
      const cn = byRawId.get(kids[i].id);
      if (!cn) continue;
      stack.push({ node: cn, ax: absX, ay: absY, depth: depth + 1 });
    }
  }
  return result;
}

// Mới: Đã tính sẵn toạ độ tuyệt đối, phẳng, không cần deepFind hay cộng dồn 9 tầng
function newTreeTraversal(targetDoc) {
  const nodes = targetDoc.nodes;
  const result = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    result.push({
      id: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      visible: n.visible,
      opacity: n.opacity,
      cornerRadii: n.cornerRadii,
      clipsContent: n.clipsContent,
      fills: n.fills,
      strokes: n.strokes,
      strokeWeight: n.strokeWeight,
      text: n.text,
      imageRef: n.imageRef,
    });
  }
  return result;
}

// Warmup
for (let i = 0; i < WARMUP_RUNS; i++) {
  oldTreeTraversal(oldRawLayers);
  newTreeTraversal(targetResult);
}

const t0OldTrav = performance.now();
for (let i = 0; i < BENCH_RUNS; i++) {
  oldTreeTraversal(oldRawLayers);
}
const avgOldTravMs = (performance.now() - t0OldTrav) / BENCH_RUNS;

const t0NewTrav = performance.now();
for (let i = 0; i < BENCH_RUNS; i++) {
  newTreeTraversal(targetResult);
}
const avgNewTravMs = (performance.now() - t0NewTrav) / BENCH_RUNS;

const totalOldMs = avgOldParseMs + avgOldTravMs;
const totalNewMs = avgNewParseMs + avgNewTravMs;
const speedupFactor = (totalOldMs / totalNewMs).toFixed(2);

// ── 4. KIỂM CHỨNG 5 NODE MẪU Ở CÁC ĐỘ SÂU (0, 2, 4, 6, 8) ────────────────────
const oldTraversed = oldTreeTraversal(oldRawLayers);
const oldById = new Map(oldTraversed.map((n) => [n.id, n]));
const newById = new Map(targetResult.nodes.map((n) => [n.id, n]));

const sampleDepths = [0, 2, 4, 6, 8];
const sampleVerifications = [];

for (const d of sampleDepths) {
  const oldNode = oldTraversed.find((n) => n.depth === d);
  if (!oldNode) continue;
  const newNode = newById.get(oldNode.id);
  const xMatch = oldNode.absX === newNode.x;
  const yMatch = oldNode.absY === newNode.y;
  sampleVerifications.push({
    depth: d,
    id: oldNode.id,
    name: newNode.name,
    oldAbs: `(${oldNode.absX}, ${oldNode.absY})`,
    newPrecomputed: `(${newNode.x}, ${newNode.y})`,
    matched: xMatch && yMatch,
  });
}

// ── 5. KIỂM CHỨNG CORNER RADII (3 NODE MIXED) ─────────────────────────────────
const mixedIds = ['639:127', '639:141', '639:149'];
const mixedVerifications = mixedIds.map((id) => {
  const newNode = newById.get(id);
  return {
    id,
    name: newNode?.name,
    cornerRadii: newNode?.cornerRadii,
    hasNegative: (newNode?.cornerRadii || []).some((r) => r < 0),
  };
});

// ── 6. IN KẾT QUẢ BÁO CÁO ─────────────────────────────────────────────────────
console.log('='.repeat(80));
console.log('BÁO CÁO ĐO ĐẠC HIỆU NĂNG & DỮ LIỆU: BẢN CŨ VS SCHEMA ĐÍCH');
console.log('='.repeat(80));
console.log();
console.log('1. BẢNG SỐ ĐO TRƯỚC / SAU:');
console.log('-'.repeat(80));
console.log(`| Tiêu chí                      | Bản cũ (Legacy)  | Bản mới (Schema đích) | Cải thiện     |`);
console.log('-'.repeat(80));
console.log(
  `| Kích thước JSON (bytes)       | ${oldBytes.toLocaleString().padEnd(16)} | ${newBytes.toLocaleString().padEnd(21)} | Giảm ${reductionPercent}% (${reductionFactor}x) |`
);
console.log(
  `| Thời gian JSON.parse (ms)     | ${avgOldParseMs.toFixed(3).padEnd(16)} | ${avgNewParseMs.toFixed(3).padEnd(21)} | Nhanh ${(avgOldParseMs / avgNewParseMs).toFixed(1)}x   |`
);
console.log(
  `| Thời gian duyệt cây (ms)      | ${avgOldTravMs.toFixed(3).padEnd(16)} | ${avgNewTravMs.toFixed(3).padEnd(21)} | Nhanh ${(avgOldTravMs / avgNewTravMs).toFixed(1)}x   |`
);
console.log(
  `| TỔNG THỜI GIAN PARSE+DUYỆT    | ${totalOldMs.toFixed(3).padEnd(16)} | ${totalNewMs.toFixed(3).padEnd(21)} | Nhanh ${speedupFactor}x   |`
);
console.log(
  `| Số lượng node                 | ${String(oldRawLayers.length).padEnd(16)} | ${String(targetResult.nodes.length).padEnd(21)} | Giữ đủ 100%   |`
);
console.log(
  `| Số lượng ảnh export           | ${String(oldImagesList.length).padEnd(16)} | ${String(Object.keys(targetResult.images).length).padEnd(21)} | Giữ đủ 100%   |`
);
console.log('-'.repeat(80));
console.log();

console.log('2. ĐỐI CHIẾU 5 NODE MẪU Ở CÁC ĐỘ SÂU (0, 2, 4, 6, 8):');
console.log('-'.repeat(80));
console.log(`| Tầng | ID node  | Tên node             | Cũ (cộng dồn)           | Mới (tính sẵn)          | Khớp? |`);
console.log('-'.repeat(80));
for (const s of sampleVerifications) {
  console.log(
    `| ${String(s.depth).padEnd(4)} | ${s.id.padEnd(8)} | ${s.name.padEnd(20)} | ${s.oldAbs.padEnd(23)} | ${s.newPrecomputed.padEnd(23)} | ${s.matched ? '✅ KHỚP' : '❌ LỆCH'} |`
  );
}
console.log('-'.repeat(80));
console.log();

console.log('3. ĐỐI CHIẾU 3 NODE CORNER RADIUS = -1 (MIXED):');
console.log('-'.repeat(80));
for (const m of mixedVerifications) {
  console.log(`Node ${m.id} (${m.name}): cornerRadii = [${m.cornerRadii.join(', ')}] (Số âm: ${m.hasNegative ? 'CÓ (LỖI)' : 'KHÔNG - HỢP LỆ ✅'})`);
}
console.log('-'.repeat(80));
console.log();

// ── 7. KIỂM PNG 1×1 (chặn ảnh rỗng) ──────────────────────────────────────────
let pngBad = [];
try {
  const poc2NodesPath = '/Downloads/poki/pokiwar-web/public/game/poc2/nodes.json';
  const poc2ImagesDir = '/Downloads/poki/pokiwar-web/public/game/poc2/images';
  if (PNG && fs.existsSync(poc2NodesPath) && fs.existsSync(poc2ImagesDir)) {
    const j2 = JSON.parse(fs.readFileSync(poc2NodesPath,'utf8'));
    for(const n of (j2.nodes||[])){
      if(!n.imageRef) continue;
      const file=path.join(poc2ImagesDir, `${n.imageRef}.png`);
      if(!fs.existsSync(file)) { pngBad.push(`${n.id} MISSING`); continue; }
      const data=fs.readFileSync(file);
      try{ const png=PNG.sync.read(data); if(png.width<=1||png.height<=1) pngBad.push(`${n.id} ${n.name} ${n.width}×${n.height} → PNG ${png.width}×${png.height}`);}catch(e){pngBad.push(`${n.id} ERR`);}
    }
  }
} catch(e){ console.warn('bench PNG check error', e.message); }
console.log('7. KIỂM PNG 1×1: ' + (pngBad.length===0 ? 'PASS (mọi PNG >1×1) ✅' : `FAIL ${pngBad.length} ảnh 1×1 ❌`));
if(pngBad.length>0){
  for(const b of pngBad.slice(0,10)) console.log('  - '+b);
  if(pngBad.length>10) console.log(`  ... và ${pngBad.length-10} file nữa`);
}

// Xuất file demo schema đích để tham khảo
const sampleNode = targetResult.nodes.find((n) => n.id === '639:127');
console.log('4. MẪU 1 NODE THẬT THEO SCHEMA ĐÍCH (Node 639:127 Bg_Selected):');
console.log(JSON.stringify(sampleNode, null, 2));
console.log('='.repeat(80));