/**
 * converter.mjs — Hàm thuần chuyển đổi node Figma sang schema đích tối ưu cho Pokiwar Web.
 * 
 * Ràng buộc:
 * - Toạ độ tuyệt đối tính sẵn (x, y, width, height)
 * - cornerRadii: [tl, tr, br, bl] (KHÔNG để -1, xử lý figma.mixed)
 * - Loại bỏ toàn bộ mixin rác (nodeParameters_*, childrenNames, parentName, etc.)
 * - imageRef chỉ gán cho visual leaf / node có image fill thật sự
 */

const PARAM_PREFIX = 'nodeParameters_';

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepFind(obj, key) {
  if (isRecord(obj)) {
    if (key in obj && isRecord(obj[key])) return obj[key];
    for (const v of Object.values(obj)) {
      const r = deepFind(v, key);
      if (r) return r;
    }
  } else if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = deepFind(v, key);
      if (r) return r;
    }
  }
  return null;
}

function deepFindRaw(obj, key) {
  if (isRecord(obj)) {
    if (key in obj) return obj[key];
    for (const v of Object.values(obj)) {
      const r = deepFindRaw(v, key);
      if (r !== undefined) return r;
    }
  } else if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = deepFindRaw(v, key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function findParam(node, key) {
  for (const k of Object.keys(node)) {
    if (!k.startsWith(PARAM_PREFIX)) continue;
    const branch = node[k];
    if (!isRecord(branch)) continue;
    const r = deepFind(branch, key);
    if (r) return r;
  }
  return null;
}

export function readGeometry(node) {
  const g = findParam(node, 'dimensionAndPositionMixin');
  if (!g) return { x: 0, y: 0, width: 0, height: 0 };
  const num = (v, d = 0) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    width: num(g.width),
    height: num(g.height),
    x: num(g.x),
    y: num(g.y),
  };
}

export function readVisible(node) {
  const s = findParam(node, 'sceneNodeMixin');
  if (!s) return true;
  return s.visible !== false;
}

export function readOpacity(node) {
  const b = findParam(node, 'minimalBlendMixin');
  const o = b?.opacity;
  return typeof o === 'number' ? o : 1;
}

export function readClipsContent(node) {
  for (const k of Object.keys(node)) {
    if (!k.startsWith(PARAM_PREFIX)) continue;
    const found = deepFindRaw(node[k], 'clipsContent');
    if (found === true) return true;
  }
  return false;
}

/**
 * Đọc 4 bán kính bo góc: [tl, tr, br, bl] theo thứ tự Canvas roundRect.
 * Xử lý figma.mixed / cornerRadius === -1 bằng cách đọc rectangleCornerMixin.
 * Đảm bảo KHÔNG bao giờ trả về số âm.
 */
export function readCornerRadii(node) {
  const rect = findParam(node, 'rectangleCornerMixin');
  const scalar = findParam(node, 'cornerMixin')?.cornerRadius;

  if (rect) {
    const num = (k) => {
      const v = rect[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const tl = num('topLeftRadius');
    const tr = num('topRightRadius');
    const bl = num('bottomLeftRadius');
    const br = num('bottomRightRadius');
    if (tl !== null && tr !== null && bl !== null && br !== null) {
      // Thứ tự Canvas roundRect: [topLeft, topRight, bottomRight, bottomLeft]
      return [Math.max(0, tl), Math.max(0, tr), Math.max(0, br), Math.max(0, bl)];
    }
  }

  if (typeof scalar === 'number' && Number.isFinite(scalar) && scalar >= 0) {
    const r = Math.max(0, scalar);
    return [r, r, r, r];
  }

  return [0, 0, 0, 0];
}

export function readFills(node) {
  const m = findParam(node, 'minimalFillsMixin');
  const fills = m?.fills;
  if (!Array.isArray(fills)) return [];
  const out = [];
  for (const f of fills) {
    if (!isRecord(f) || f.visible === false) continue;
    const op = typeof f.opacity === 'number' ? f.opacity : 1;
    if (op <= 0) continue;
    const c = f.color;
    if (isRecord(c)) {
      out.push({
        type: typeof f.type === 'string' ? f.type : 'SOLID',
        color: {
          r: typeof c.r === 'number' ? c.r : 0,
          g: typeof c.g === 'number' ? c.g : 0,
          b: typeof c.b === 'number' ? c.b : 0,
          a: typeof c.a === 'number' ? c.a : op,
        },
      });
    } else {
      out.push({
        type: typeof f.type === 'string' ? f.type : 'SOLID',
        opacity: op,
      });
    }
  }
  return out;
}

export function readStrokes(node) {
  const m = findParam(node, 'minimalStrokesMixin');
  if (!m) return [];
  const inner = isRecord(m.stroke) ? m.stroke : null;
  const list = m.strokes ?? inner?.strokes;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const f of list) {
    if (!isRecord(f) || f.visible === false) continue;
    const c = f.color;
    if (isRecord(c)) {
      out.push({
        type: typeof f.type === 'string' ? f.type : 'SOLID',
        color: {
          r: typeof c.r === 'number' ? c.r : 0,
          g: typeof c.g === 'number' ? c.g : 0,
          b: typeof c.b === 'number' ? c.b : 0,
          a: typeof c.a === 'number' ? c.a : 1,
        },
      });
    }
  }
  return out;
}

export function readStrokeWeight(node) {
  const m = findParam(node, 'minimalStrokesMixin');
  if (!m) return 0;
  const inner = isRecord(m.stroke) ? m.stroke : null;
  const w = m.strokeWeight ?? inner?.strokeWeight;
  const num = typeof w === 'number' ? w : Number(w);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function readStrokeAlign(node) {
  const m = findParam(node, 'minimalStrokesMixin');
  const inner = isRecord(m?.stroke) ? m.stroke : null;
  return String(m?.strokeAlign ?? inner?.strokeAlign ?? 'CENTER');
}

export function readText(node) {
  if (node.type !== 'TEXT') return null;
  const t = findParam(node, 'nonResizableTextMixin');
  const chars = t?.characters;
  const text = typeof chars === 'string' ? chars : '';
  const fs = t?.fontSize;
  const fname = t?.fontName;
  const family = isRecord(fname) && typeof fname.family === 'string' ? fname.family : 'sans-serif';
  const style = isRecord(fname) && typeof fname.style === 'string' ? fname.style : 'Regular';

  let alignH = 'CENTER';
  let alignV = 'CENTER';
  for (const k of Object.keys(node)) {
    if (!k.startsWith(PARAM_PREFIX)) continue;
    const h = deepFindRaw(node[k], 'textAlignHorizontal');
    const v = deepFindRaw(node[k], 'textAlignVertical');
    if (typeof h === 'string') alignH = h;
    if (typeof v === 'string') alignV = v;
  }

  const lh = t?.lineHeight;
  const lhUnit = isRecord(lh) && typeof lh.unit === 'string' ? lh.unit : null;
  const lhVal = isRecord(lh) && typeof lh.value === 'number' ? lh.value : null;

  let textAutoResize = null;
  for (const k of Object.keys(node)) {
    if (!k.startsWith(PARAM_PREFIX)) continue;
    const ar = deepFindRaw(node[k], 'textAutoResize');
    if (typeof ar === 'string') textAutoResize = ar;
  }

  return {
    characters: text,
    fontSize: typeof fs === 'number' ? fs : 14,
    fontName: { family, style },
    fills: readFills(node),
    textAlign: alignH,
    textAlignVertical: alignV,
    lineHeight: lhUnit ? { unit: lhUnit, value: lhVal } : null,
    textAutoResize,
  };
}

/**
 * Xác định xem node có phải là visual leaf thật sự hay không.
 * KHÔNG xuất ảnh cho node rỗng / khung cha (FRAME, GROUP, SECTION có con).
 */
export function isVisualLeafNode(node, kidsCount = 0) {
  const g = readGeometry(node);
  if (g.width <= 0 || g.height <= 0) return false;

  // Khung cha có con -> không phải visual leaf (tránh lỗi của plugin cũ)
  if (kidsCount > 0) return false;

  // Node TEXT được vẽ bằng Canvas text -> không cần ảnh
  if (node.type === 'TEXT') return false;

  // Nếu là legacy node có cờ isVisualNode = true
  if (node.nodeParameters_VisualNode?.isVisualNode === true) return true;

  // Node có IMAGE fill
  const fills = readFills(node);
  if (fills.some((f) => f.type === 'IMAGE')) return true;

  // Visual shapes (RECTANGLE, ELLIPSE, VECTOR, ...)
  const shapeTypes = new Set(['RECTANGLE', 'ELLIPSE', 'VECTOR', 'STAR', 'POLYGON', 'LINE']);
  if (shapeTypes.has(node.type)) {
    return true;
  }

  return false;
}

/**
 * Chuyển đổi toàn bộ danh sách raw nodes (từ nodes.json cũ) sang schema đích.
 * Tự động tính toạ độ tuyệt đối bằng DFS từ root, gộp cornerRadii, gán imageRef chuẩn.
 */
export function convertRawLayersToTargetSchema(rawLayers, availableImages = []) {
  const byRawId = new Map();
  for (const n of rawLayers) byRawId.set(n.id, n);

  const availableImageSet = new Set(
    availableImages.map((img) => img.replace(/\.png$/i, ''))
  );

  const roots = rawLayers.filter((n) => !n.parentID || !byRawId.has(n.parentID));
  const root = roots[0] || rawLayers[0];

  const targetNodes = [];
  const imagesManifest = {};

  // DFS pre-order: duyệt đúng thứ tự z của Figma
  const stack = [{ node: root, ax: 0, ay: 0, depth: 0 }];
  const seen = new Set();

  while (stack.length > 0) {
    const { node, ax, ay, depth } = stack.pop();
    if (seen.has(node.id)) continue;
    seen.add(node.id);

    const g = readGeometry(node);
    const absX = ax + g.x;
    const absY = ay + g.y;

    const kids = Array.isArray(node.childrenNames) ? node.childrenNames : [];
    const isLeaf = isVisualLeafNode(node, kids.length);

    // imageRef: chỉ gán khi là visual leaf (và có trong manifest ảnh nếu cung cấp)
    const imgKey = node.id.replace(/:/g, '_');
    let imageRef = null;
    if (isLeaf) {
      if (availableImages.length === 0 || availableImageSet.has(imgKey)) {
        imageRef = imgKey;
        imagesManifest[imgKey] = `${imgKey}.png`;
      }
    }

    const targetNode = {
      id: node.id,
      name: node.name,
      type: node.type,
      parentID: node.parentID ?? null,
      x: absX,
      y: absY,
      width: g.width,
      height: g.height,
      visible: readVisible(node),
      opacity: readOpacity(node),
      cornerRadii: readCornerRadii(node),
      fills: readFills(node),
      strokes: readStrokes(node),
      strokeWeight: readStrokeWeight(node),
      strokeAlign: readStrokeAlign(node),
      clipsContent: readClipsContent(node),
      text: readText(node),
      imageRef,
    };

    targetNodes.push(targetNode);

    // Duyệt con ngược để pop ra đúng thứ tự
    for (let i = kids.length - 1; i >= 0; i--) {
      const cn = byRawId.get(kids[i].id);
      if (!cn) continue;
      stack.push({ node: cn, ax: absX, ay: absY, depth: depth + 1 });
    }
  }

  const rootTarget = targetNodes[0];

  return {
    designWidth: rootTarget ? rootTarget.width : 1440,
    designHeight: rootTarget ? rootTarget.height : 720,
    nodes: targetNodes,
    images: imagesManifest,
  };
}
