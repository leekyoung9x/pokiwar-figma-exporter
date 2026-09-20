/**
 * test.mjs — Bộ kiểm thử tự động (node --test) cho Pokiwar Canvas Exporter
 * 
 * Kiểm tra các ca:
 * 1. Node cornerRadius = -1 (MIXED) -> cornerRadii [tl, tr, br, bl] không âm
 * 2. Node có text -> cấu trúc text đầy đủ, node không phải text -> text = null
 * 3. Node có image / visual leaf -> imageRef hợp lệ; node rác / khung cha -> KHÔNG sinh ảnh
 * 4. Node lồng sâu 9 tầng -> toạ độ tuyệt đối khớp chính xác phép cộng dồn
 * 5. Tính toàn vẹn của toàn bộ tài liệu 316 node
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  convertRawLayersToTargetSchema,
  readGeometry,
  readVisible,
  readOpacity,
  readCornerRadii,
  readFills,
  readStrokes,
  readStrokeWeight,
  readText,
  isVisualLeafNode,
} from './converter.mjs';

const OLD_NODES_PATH = '/Downloads/poki/pokiwar-web/public/game/poc/nodes.json';
const OLD_IMAGES_PATH = '/Downloads/poki/pokiwar-web/public/game/poc/images.json';

const oldRawLayers = JSON.parse(fs.readFileSync(OLD_NODES_PATH, 'utf8')).flattenLayers;
const oldImagesList = JSON.parse(fs.readFileSync(OLD_IMAGES_PATH, 'utf8')).images;

describe('Pokiwar Canvas Exporter Test Suite', () => {
  // ── CA 1: cornerRadius = -1 (MIXED) ─────────────────────────────────────────
  test('Ca 1: Xử lý cornerRadius = -1 (MIXED) -> cornerRadii [tl, tr, br, bl] không âm', () => {
    // 1.1 Node thực tế từ nodes.json: 639:127 (Bg_Selected)
    const raw127 = oldRawLayers.find((n) => n.id === '639:127');
    assert.ok(raw127, 'Node 639:127 phải tồn tại');
    const radii127 = readCornerRadii(raw127);
    assert.deepEqual(radii127, [0, 25, 25, 0], 'Node 639:127 phải có bán kính [0, 25, 25, 0]');
    assert.ok(radii127.every((r) => r >= 0), 'Mọi góc phải >= 0, không được âm');

    // 1.2 Kiểm tra cả 3 node MIXED trong tài liệu thật
    const mixedIds = ['639:127', '639:141', '639:149'];
    for (const id of mixedIds) {
      const node = oldRawLayers.find((n) => n.id === id);
      const radii = readCornerRadii(node);
      assert.deepEqual(radii, [0, 25, 25, 0], `Node ${id} phải bo 2 góc phải 25px`);
      assert.ok(radii.every((r) => r >= 0), `Node ${id} không được có góc âm`);
    }

    // 1.3 Node giả lập có cornerRadius = -1 và 4 góc khác nhau
    const syntheticMixedNode = {
      id: 'syn:1',
      name: 'Synthetic_Mixed',
      type: 'RECTANGLE',
      nodeParameters_VisualNode: {
        cornerMixin: { cornerRadius: -1 },
        rectangleCornerMixin: {
          topLeftRadius: 10,
          topRightRadius: 20,
          bottomRightRadius: 30,
          bottomLeftRadius: 40,
        },
      },
    };
    const synRadii = readCornerRadii(syntheticMixedNode);
    // Thứ tự Canvas: [tl, tr, br, bl]
    assert.deepEqual(synRadii, [10, 20, 30, 40], 'Phải đọc đúng thứ tự [tl, tr, br, bl]');
    assert.ok(synRadii.every((r) => r >= 0), 'Không được có góc âm');
  });

  // ── CA 2: Node có text ──────────────────────────────────────────────────────
  test('Ca 2: Node TEXT -> text object đầy đủ; Node non-TEXT -> text = null', () => {
    // 2.1 Node TEXT thật: 639:163 (Txt_Description)
    const textNode = oldRawLayers.find((n) => n.id === '639:163');
    assert.ok(textNode, 'Node 639:163 phải tồn tại');
    const parsedText = readText(textNode);
    assert.ok(parsedText !== null, 'parsedText không được null với node TEXT');
    assert.ok(typeof parsedText.characters === 'string' && parsedText.characters.length > 0, 'Phải có nội dung chữ');
    assert.equal(parsedText.fontSize, 18, 'Cỡ chữ phải là 18');
    assert.equal(parsedText.textAlign, 'LEFT', 'Canh ngang của Txt_Description phải là LEFT');
    assert.equal(parsedText.textAlignVertical, 'CENTER', 'Canh dọc của Txt_Description phải là CENTER');
    assert.ok(parsedText.fontName && typeof parsedText.fontName.family === 'string', 'Phải có font family');

    // 2.2 Node non-TEXT: Frame/Rectangle
    const frameNode = oldRawLayers.find((n) => n.id === '732:2');
    assert.equal(readText(frameNode), null, 'Node SECTION/FRAME phải có text = null');

    const rectNode = oldRawLayers.find((n) => n.id === '575:4');
    assert.equal(readText(rectNode), null, 'Node RECTANGLE phải có text = null');
  });

  // ── CA 3: Node ảnh & Chống sinh ảnh rác ──────────────────────────────────────
  test('Ca 3: Visual leaf có ảnh; Khung cha / Node rỗng KHÔNG sinh ảnh', () => {
    // 3.1 Node visual leaf: RECTANGLE không con (575:4 Bg_Main)
    const leafNode = oldRawLayers.find((n) => n.id === '575:4');
    assert.equal(isVisualLeafNode(leafNode, 0), true, 'Node 575:4 phải là visual leaf');

    // 3.2 Khung cha có con: SECTION (732:2 Screen_PetDetail) -> KHÔNG sinh ảnh
    const rootNode = oldRawLayers.find((n) => n.id === '732:2');
    assert.equal(isVisualLeafNode(rootNode, 3), false, 'Khung cha có con KHÔNG được là visual leaf');

    // 3.3 Khung cha có con: FRAME (639:95 Popup_PetSort) -> KHÔNG sinh ảnh
    const popupNode = oldRawLayers.find((n) => n.id === '639:95');
    const popupKids = Array.isArray(popupNode.childrenNames) ? popupNode.childrenNames.length : 1;
    assert.equal(isVisualLeafNode(popupNode, popupKids), false, 'Popup_PetSort có con KHÔNG được là visual leaf');

    // 3.4 Node TEXT -> KHÔNG sinh ảnh
    const txtNode = oldRawLayers.find((n) => n.id === '639:163');
    assert.equal(isVisualLeafNode(txtNode, 0), false, 'Node TEXT KHÔNG được sinh ảnh');

    // 3.5 Node rỗng w=0, h=0 -> KHÔNG sinh ảnh
    const emptyNode = {
      id: 'empty:1',
      name: 'Empty_Node',
      type: 'FRAME',
      nodeParameters_VisualNode: {
        defaultShapeMixin: {
          layoutMixin: {
            dimensionAndPositionMixin: { width: 0, height: 0, x: 0, y: 0 },
          },
        },
      },
    };
    assert.equal(isVisualLeafNode(emptyNode, 0), false, 'Node kích thước 0x0 KHÔNG được sinh ảnh');
  });

  // ── CA 4: Node lồng sâu 9 tầng ──────────────────────────────────────────────
  test('Ca 4: Node lồng sâu 9 tầng -> Toạ độ tuyệt đối khớp chính xác phép cộng dồn', () => {
    // 4.1 Node thực tế ở tầng 8: 690:335 (Img_Material)
    const targetDoc = convertRawLayersToTargetSchema(oldRawLayers, oldImagesList);
    const node690_335 = targetDoc.nodes.find((n) => n.id === '690:335');
    assert.ok(node690_335, 'Node 690:335 phải có trong tài liệu mới');

    // Tính tay phép cộng dồn từ root xuống 690:335
    // Chuỗi tổ tiên: 732:2 -> 689:2 -> 689:3 -> 639:160 -> 682:3 -> 682:5 -> 682:7 -> 682:9 -> 690:335
    const expectedAbsX = 1171.05126953125;
    const expectedAbsY = 515.742431640625;

    assert.equal(node690_335.x, expectedAbsX, 'absX phải khớp chính xác phép cộng dồn 9 tầng');
    assert.equal(node690_335.y, expectedAbsY, 'absY phải khớp chính xác phép cộng dồn 9 tầng');

    // 4.2 Cây giả lập lồng sâu 9 tầng
    const synthetic9Layers = [];
    let currentParent = null;
    for (let depth = 0; depth < 9; depth++) {
      const id = `depth_${depth}`;
      const isLeaf = depth === 8;
      synthetic9Layers.push({
        id,
        name: `Node_Depth_${depth}`,
        type: isLeaf ? 'RECTANGLE' : 'FRAME',
        parentID: currentParent,
        childrenNames: isLeaf ? [] : [{ id: `depth_${depth + 1}` }],
        nodeParameters_VisualNode: {
          defaultShapeMixin: {
            sceneNodeMixin: { visible: true },
            layoutMixin: {
              dimensionAndPositionMixin: { width: 100, height: 100, x: 10, y: 20 },
            },
          },
        },
      });
      currentParent = id;
    }

    const synDoc = convertRawLayersToTargetSchema(synthetic9Layers);
    assert.equal(synDoc.nodes.length, 9, 'Phải chuyển đổi đủ 9 node');
    for (let depth = 0; depth < 9; depth++) {
      const n = synDoc.nodes[depth];
      // Mỗi tầng dịch (10, 20) -> tầng d có abs = (10 * (d+1), 20 * (d+1))
      assert.equal(n.x, 10 * (depth + 1), `Tầng ${depth} x phải = ${10 * (depth + 1)}`);
      assert.equal(n.y, 20 * (depth + 1), `Tầng ${depth} y phải = ${20 * (depth + 1)}`);
    }
  });

  // ── CA 5: Kiểm tra toàn vẹn tài liệu 316 node ────────────────────────────────
  test('Ca 5: Kiểm tra toàn vẹn chuyển đổi tài liệu thật', () => {
    const targetDoc = convertRawLayersToTargetSchema(oldRawLayers, oldImagesList);

    // 5.1 Số node giữ đủ 100%
    assert.equal(targetDoc.nodes.length, 316, 'Số node phải đúng 316');

    // 5.2 Kích thước thiết kế
    assert.equal(targetDoc.designWidth, 1440, 'Design width = 1440');
    assert.equal(targetDoc.designHeight, 720, 'Design height = 720');

    // 5.3 Mọi node có cornerRadii hợp lệ (không chứa số âm)
    for (const n of targetDoc.nodes) {
      assert.ok(Array.isArray(n.cornerRadii), `Node ${n.id} cornerRadii phải là mảng`);
      assert.equal(n.cornerRadii.length, 4, `Node ${n.id} cornerRadii phải có 4 phần tử`);
      assert.ok(
        n.cornerRadii.every((r) => typeof r === 'number' && Number.isFinite(r) && r >= 0),
        `Node ${n.id} có cornerRadii không hợp lệ: [${n.cornerRadii}]`
      );
    }

    // 5.4 Toàn bộ 116 ảnh được giữ đúng
    assert.equal(Object.keys(targetDoc.images).length, 116, 'Phải có đúng 116 ảnh trong manifest');

    // 5.5 Không có khung cha nào sinh ảnh
    const parentsWithImages = targetDoc.nodes.filter(
      (n) => (n.type === 'SECTION' || n.type === 'FRAME' || n.type === 'GROUP') && n.imageRef !== null
    );
    assert.equal(parentsWithImages.length, 0, 'Không được có khung cha nào có imageRef');
  });
});
