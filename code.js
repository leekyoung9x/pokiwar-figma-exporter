/**
 * Pokiwar Canvas Exporter — Figma Plugin Main Code (code.js)
 * 
 * Chức năng:
 * - Duyệt cây scene graph theo DFS pre-order (chuẩn z-order).
 * - Tính toạ độ TUYỆT ĐỐI sẵn (x, y, width, height) dựa trên absoluteBoundingBox.
 * - Xử lý figma.mixed cho bo góc -> [tl, tr, br, bl] không bao giờ âm.
 * - Xuất thông tin text, fills, strokes, clipsContent.
 * - Chỉ xuất ảnh PNG cho visual leaf thật sự / node có image fill; KHÔNG xuất cho khung cha/node rỗng.
 * - Xuất kèm images.json (manifest ánh xạ imageRef -> tên file).
 */

figma.showUI(__html__, {
  width: 460,
  height: 640,
  themeColors: true,
  title: 'Pokiwar Canvas Exporter',
});

function getSelectionInfo() {
  const sel = figma.currentPage.selection;
  return {
    hasSelection: sel.length > 0,
    selectionCount: sel.length,
    selectionNames: sel.slice(0, 3).map((n) => n.name).join(', ') + (sel.length > 3 ? '...' : ''),
    pageName: figma.currentPage.name,
  };
}

// Gửi trạng thái ban đầu lên UI
figma.ui.postMessage({ type: 'init', data: getSelectionInfo() });

// Cập nhật khi người dùng đổi selection trên canvas
figma.on('selectionchange', () => {
  figma.ui.postMessage({ type: 'selection-change', data: getSelectionInfo() });
});

/**
 * Đọc 4 bán kính bo góc: [tl, tr, br, bl] theo thứ tự Canvas roundRect.
 * Xử lý figma.mixed triệt để, KHÔNG bao giờ trả về số âm.
 */
function getCornerRadii(node) {
  if ('cornerRadius' in node) {
    if (node.cornerRadius === figma.mixed) {
      return [
        Math.max(0, typeof node.topLeftRadius === 'number' ? node.topLeftRadius : 0),
        Math.max(0, typeof node.topRightRadius === 'number' ? node.topRightRadius : 0),
        Math.max(0, typeof node.bottomRightRadius === 'number' ? node.bottomRightRadius : 0),
        Math.max(0, typeof node.bottomLeftRadius === 'number' ? node.bottomLeftRadius : 0),
      ];
    } else if (typeof node.cornerRadius === 'number') {
      const r = Math.max(0, node.cornerRadius);
      return [r, r, r, r];
    }
  }
  return [0, 0, 0, 0];
}

/**
 * Đọc mảng fills đã chuẩn hoá.
 */
function getFills(node) {
  if (!('fills' in node) || node.fills === figma.mixed || !Array.isArray(node.fills)) return [];
  return node.fills
    .filter((f) => f.visible !== false)
    .map((f) => {
      if (f.type === 'SOLID' && f.color) {
        return {
          type: 'SOLID',
          color: {
            r: f.color.r,
            g: f.color.g,
            b: f.color.b,
            a: typeof f.opacity === 'number' ? f.opacity : 1,
          },
        };
      }
      return {
        type: f.type,
        opacity: typeof f.opacity === 'number' ? f.opacity : 1,
      };
    });
}

/**
 * Đọc mảng strokes đã chuẩn hoá.
 */
function getStrokes(node) {
  if (!('strokes' in node) || !Array.isArray(node.strokes)) return [];
  return node.strokes
    .filter((s) => s.visible !== false)
    .map((s) => {
      if (s.type === 'SOLID' && s.color) {
        return {
          type: 'SOLID',
          color: {
            r: s.color.r,
            g: s.color.g,
            b: s.color.b,
            a: typeof s.opacity === 'number' ? s.opacity : 1,
          },
        };
      }
      return {
        type: s.type,
        opacity: typeof s.opacity === 'number' ? s.opacity : 1,
      };
    });
}

/**
 * Kiểm tra xem node có phải là visual leaf thật sự cần xuất PNG hay không.
 * KHÔNG xuất ảnh cho:
 * - Khung cha có con (FRAME, GROUP, SECTION...)
 * - Node TEXT (vẽ bằng canvas text)
 * - Node rỗng / kích thước 0x0
 * - Node bị ẩn (visible = false)
 */
function isVisualLeaf(node) {
  if (!node.visible) return false;
  if (node.width <= 0 || node.height <= 0) return false;

  // Khung cha có con -> không xuất ảnh riêng cho khung
  if ('children' in node && node.children.length > 0) return false;

  // Text -> vẽ bằng Canvas text
  if (node.type === 'TEXT') return false;

  // Node có image fill
  if (Array.isArray(node.fills)) {
    if (node.fills.some((f) => f.type === 'IMAGE' && f.visible !== false)) return true;
  }

  // Visual shapes
  const leafTypes = new Set(['RECTANGLE', 'ELLIPSE', 'VECTOR', 'STAR', 'POLYGON', 'LINE', 'BOOLEAN_OPERATION']);
  if (leafTypes.has(node.type)) {
    const hasFill = Array.isArray(node.fills) && node.fills.some((f) => f.visible !== false);
    const hasStroke = Array.isArray(node.strokes) && node.strokes.some((s) => s.visible !== false);
    return hasFill || hasStroke;
  }

  return false;
}

/**
 * Xử lý lệnh export từ UI.
 */
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export') {
    const startTime = Date.now();
    const scope = msg.scope || 'selection';
    const exportImages = msg.exportImages !== false;

    // Xác định tập node gốc
    let rootNodes = [];
    if (scope === 'selection' && figma.currentPage.selection.length > 0) {
      rootNodes = Array.from(figma.currentPage.selection);
    } else {
      rootNodes = Array.from(figma.currentPage.children);
    }

    if (rootNodes.length === 0) {
      figma.ui.postMessage({
        type: 'error',
        message: 'Không tìm thấy node nào để export. Hãy chọn ít nhất 1 frame hoặc chọn "Toàn bộ Page".',
      });
      return;
    }

    figma.ui.postMessage({ type: 'status', message: 'Đang duyệt cây đối tượng...' });

    // Lấy toạ độ gốc tham chiếu từ root node đầu tiên
    const firstRoot = rootNodes[0];
    const rootBounds = firstRoot.absoluteBoundingBox || { x: 0, y: 0, width: firstRoot.width || 1440, height: firstRoot.height || 720 };
    const refX = rootBounds.x;
    const refY = rootBounds.y;

    const exportedNodes = [];
    const leafNodesForImages = [];

    // Duyệt DFS pre-order bảo toàn z-order (con đầu vẽ trước, con cuối đè lên)
    // ancVis = effectiveVisible của tổ tiên (true = mọi tổ tiên đều visible)
    function traverse(node, parentId = null, ancVis = true) {
      const box = node.absoluteBoundingBox;
      // Toạ độ tuyệt đối tính sẵn so với gốc màn hình
      const x = box ? Math.round((box.x - refX) * 100) / 100 : 0;
      const y = box ? Math.round((box.y - refY) * 100) / 100 : 0;
      const width = box ? Math.round(box.width * 100) / 100 : Math.round((node.width || 0) * 100) / 100;
      const height = box ? Math.round(box.height * 100) / 100 : Math.round((node.height || 0) * 100) / 100;

      const ownVisible = node.visible !== false;
      const effVis = ancVis && ownVisible;
      const visible = ownVisible;
      const opacity = typeof node.opacity === 'number' ? node.opacity : 1;
      const cornerRadii = getCornerRadii(node);
      const fills = getFills(node);
      const strokes = getStrokes(node);
      const strokeWeight = typeof node.strokeWeight === 'number' ? node.strokeWeight : 0;
      const strokeAlign = typeof node.strokeAlign === 'string' ? node.strokeAlign : 'CENTER';
      const clipsContent = typeof node.clipsContent === 'boolean' ? node.clipsContent : false;

      // Xử lý text
      let text = null;
      if (node.type === 'TEXT') {
        const chars = node.characters || '';
        const fs = typeof node.fontSize === 'number' ? node.fontSize : 14;
        const fontName =
          node.fontName && node.fontName !== figma.mixed
            ? { family: node.fontName.family, style: node.fontName.style }
            : { family: 'sans-serif', style: 'Regular' };
        const lh = node.lineHeight && node.lineHeight !== figma.mixed ? node.lineHeight : null;
        const lhObj = lh ? { unit: lh.unit, value: typeof lh.value === 'number' ? lh.value : null } : null;

        text = {
          characters: chars,
          fontSize: fs,
          fontName,
          fills: fills,
          textAlign: node.textAlignHorizontal || 'LEFT',
          textAlignVertical: node.textAlignVertical || 'TOP',
          lineHeight: lhObj,
          textAutoResize: node.textAutoResize || null,
        };
      }

      const isLeaf = isVisualLeaf(node);
      const imgKey = isLeaf ? node.id.replace(/:/g, '_') : null;

      if (isLeaf && exportImages) {
        leafNodesForImages.push({ node, imgKey, effVis, ancVis });
      }

      const item = {
        id: node.id,
        name: node.name,
        type: node.type,
        parentID: parentId,
        x,
        y,
        width,
        height,
        visible,
        opacity,
        cornerRadii,
        fills,
        strokes,
        strokeWeight,
        strokeAlign,
        clipsContent,
        text,
        imageRef: imgKey,
      };

      exportedNodes.push(item);

      // Đệ quy con theo thứ tự Figma (0 là dưới cùng, length-1 là trên cùng)
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child, node.id, effVis);
        }
      }
    }

    for (const root of rootNodes) {
      traverse(root, null, true);
    }

    // Xuất ảnh cho các visual leaf
    const imagesManifest = {};
    const imagesData = [];
    const totalImages = leafNodesForImages.length;

    if (exportImages && totalImages > 0) {
      figma.ui.postMessage({
        type: 'status',
        message: `Đang xuất ${totalImages} ảnh PNG...`,
        current: 0,
        total: totalImages,
      });

      // Helper: đọc width/height từ PNG Uint8Array (IHDR)
      function pngSize(bytes) {
        try {
          if (!bytes || bytes.length < 24) return null;
          // PNG signature 8 bytes + IHDR length 4 + type 4 + width 4 + height 4
          const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
          const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
          if (w > 0 && h > 0 && w < 10000 && h < 10000) return { w, h };
          return null;
        } catch { return null; }
      }

      let skipped1x1 = 0;
      const failedIds = new Set();
      for (let i = 0; i < totalImages; i++) {
        const { node, imgKey, effVis } = leafNodesForImages[i];
        const filename = `${imgKey}.png`;
        // Nếu node nằm trong cây ẩn (effVis===false) → tạm bật các tổ tiên ẩn trước khi export
        const hiddenAncestors = [];
        if (effVis === false) {
          try {
            let cur = node.parent;
            while (cur) {
              if (cur.visible === false) hiddenAncestors.push(cur);
              cur = cur.parent;
            }
            for (const anc of hiddenAncestors) anc.visible = true;
          } catch {}
        }
        try {
          const bytes = await node.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: 1 },
          });
          const sz = pngSize(bytes);
          if (sz && sz.w === 1 && sz.h === 1) {
            skipped1x1++;
            failedIds.add(node.id);
            console.warn(`[Pokiwar Exporter] Bỏ ảnh 1×1 ${node.id} (${node.name}) size node ${Math.round(node.width)}×${Math.round(node.height)} → PNG 1×1`);
            // Không đưa vào manifest → nodes.json sẽ bị null imageRef ở bước sau
            if (skipped1x1 <= 10) {
              figma.ui.postMessage({ type: 'status', message: `Phát hiện ảnh 1×1: ${node.id} (${node.width}×${node.height})` });
            }
          } else {
            imagesManifest[imgKey] = filename;
            imagesData.push({
              name: filename,
              bytes: bytes,
            });
          }
        } catch (err) {
          console.warn(`[Pokiwar Exporter] Không thể xuất ảnh cho node ${node.id}:`, err);
          failedIds.add(node.id);
        } finally {
          // Khôi phục visible cho tổ tiên
          for (const anc of hiddenAncestors) {
            try { anc.visible = false; } catch {}
          }
        }

        if ((i + 1) % 5 === 0 || i + 1 === totalImages) {
          figma.ui.postMessage({
            type: 'progress',
            current: i + 1,
            total: totalImages,
            message: `Đang xuất ảnh (${i + 1}/${totalImages})...`,
          });
        }
      }
    }

    // Null imageRef cho node bị 1×1 / lỗi export (đừng sinh file rỗng)
    if (skipped1x1 > 0 || failedIds.size > 0) {
      for (const item of exportedNodes) {
        const key = item.id.replace(/:/g, '_');
        if (failedIds.has(item.id) || (item.imageRef && !imagesManifest[key])) {
          item.imageRef = null;
        }
      }
      console.warn(`[Pokiwar Exporter] Tổng bỏ ${skipped1x1} ảnh 1×1 / ${failedIds.size} lỗi`);
    }

    const designW = rootBounds.width || 1440;
    const designH = rootBounds.height || 720;

    const nodesDoc = {
      designWidth: Math.round(designW),
      designHeight: Math.round(designH),
      nodeCount: exportedNodes.length,
      nodes: exportedNodes,
    };

    const imagesDoc = {
      count: Object.keys(imagesManifest).length,
      images: imagesManifest,
    };

    const nodesJsonStr = JSON.stringify(nodesDoc);
    const imagesJsonStr = JSON.stringify(imagesDoc);

    const elapsedMs = Date.now() - startTime;

    // Gửi kết quả hoàn chỉnh về UI
    figma.ui.postMessage({
      type: 'export-complete',
      nodesJson: nodesJsonStr,
      imagesJson: imagesJsonStr,
      imagesData: imagesData,
      stats: {
        nodeCount: exportedNodes.length,
        imageCount: Object.keys(imagesManifest).length,
        nodesBytes: nodesJsonStr.length,
        imagesBytes: imagesJsonStr.length,
        elapsedMs,
      },
    });
  }
};
