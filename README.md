# Pokiwar Canvas Exporter (`figma-plugin-pokiwar`)

Figma Plugin chuyên dụng xuất dữ liệu giao diện sang chuẩn **Pokiwar Canvas Web**, phục vụ trực tiếp cho `canvas-renderer.ts` và `poc-bindings.ts`.

---

## 1. HƯỚNG DẪN CÀI ĐẶT & SỬ DỤNG (3 BƯỚC CHO ARTIST)

1. **Bước 1 — Mở Figma & Import Plugin:**
   - Trong Figma Desktop, vào Menu chính (biểu tượng Figma góc trên-trái) -> **Plugins** -> **Development** -> **Import plugin from manifest...**
   - Chọn đường dẫn tới file `manifest.json` trong thư mục `figma-plugin-pokiwar/manifest.json`.
   - Plugin `Pokiwar Canvas Exporter` sẽ xuất hiện trong danh sách plugin Development.

2. **Bước 2 — Chọn Frame cần xuất & Khởi chạy Plugin:**
   - Chọn màn hình / Frame cần xuất (ví dụ: `Screen_PetDetail`). Nếu không chọn gì, plugin cho phép xuất toàn bộ Page.
   - Chuột phải -> **Plugins** -> **Development** -> **Pokiwar Canvas Exporter**.
   - Hộp thoại plugin mở ra, hiển thị tên Frame đang chọn.

3. **Bước 3 — Nhấn Export & Tải file:**
   - Nhấn nút **⚡ Export cho Pokiwar Web**.
   - Plugin duyệt cây đối tượng, tính sẵn toạ độ tuyệt đối và xuất ảnh PNG cho các visual leaf.
   - Nhấn **📦 Tải trọn bộ .ZIP (nodes + images)** để nhận gói hoàn chỉnh gồm `nodes.json`, `images.json` và thư mục `images/`.

---

## 2. SCHEMA ĐÍCH CỦA MỖI NODE

Mỗi node trong `nodes.json` xuất theo cấu trúc tinh gọn tối đa:

```json
{
  "id": "639:127",
  "name": "Bg_Selected",
  "type": "FRAME",
  "parentID": "639:131",
  "x": 1283,
  "y": 118,
  "width": 129,
  "height": 42,
  "visible": true,
  "opacity": 1,
  "cornerRadii": [0, 25, 25, 0],
  "fills": [
    {
      "type": "SOLID",
      "color": { "r": 0.051, "g": 0.380, "b": 0.784, "a": 1 }
    }
  ],
  "strokes": [],
  "strokeWeight": 0,
  "strokeAlign": "CENTER",
  "clipsContent": true,
  "text": null,
  "imageRef": null
}
```

### Các trường trong schema:
- `id`: ID gốc từ Figma (ví dụ `"639:127"`).
- `name`: Tên node theo quy chuẩn (ví dụ `"Bg_Selected"`, `"Txt_Description"`). Web dùng để dò node động theo TÊN.
- `type`: Loại node (`SECTION`, `FRAME`, `GROUP`, `RECTANGLE`, `TEXT`, `ELLIPSE`...).
- `parentID`: ID của node cha trực tiếp (`null` nếu là root).
- `x`, `y`, `width`, `height`: **Toạ độ TUYỆT ĐỐI** đã tính sẵn so với gốc màn hình (không để tương đối, web không phải cộng dồn qua 9 tầng).
- `visible`: Cờ hiển thị của node (`true` / `false`).
- `opacity`: Độ mờ đục (0..1).
- `cornerRadii`: Mảng 4 số `[tl, tr, br, bl]` theo thứ tự Canvas `roundRect(x, y, w, h, [tl, tr, br, bl])`. Xử lý triệt để `figma.mixed` (không bao giờ để `-1`).
- `fills`: Mảng màu tô (`SOLID`, `IMAGE`...).
- `strokes`: Mảng màu viền.
- `strokeWeight`: Độ dày viền (px).
- `strokeAlign`: Căn lề viền (`CENTER`, `INSIDE`, `OUTSIDE`).
- `clipsContent`: Khung này có cắt con tràn viền hay không (Canvas `clip()`).
- `text`: Thông tin văn bản (chỉ có khi `type === "TEXT"`), gồm: `characters`, `fontSize`, `fontName`, `textAlign`, `textAlignVertical`, `lineHeight`, `textAutoResize`.
- `imageRef`: Khóa ánh xạ trong `images.json` (chỉ có khi node là visual leaf / có ảnh thật; khung cha và node rỗng luôn là `null`).

---

## 3. CÁC CẢI TIẾN CỐT LÕI SO VỚI BẢN EXPORT CŨ

1. **Toạ độ tuyệt đối tính sẵn:**
   - Bản cũ: Lưu toạ độ tương đối so với cha, sâu tới 9 tầng -> web phải duyệt đệ quy cộng dồn.
   - Bản mới: `x`, `y` tính sẵn từ `absoluteBoundingBox` -> web đọc thẳng, vẽ ngay.

2. **Xử lý `figma.mixed` bo góc:**
   - Bản cũ: Xuất `cornerRadius = -1` (Figma MIXED) ở 3 node tab (`639:127`, `639:141`, `639:149`) khiến web vẽ vuông tab.
   - Bản mới: Đọc `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius` -> `[0, 25, 25, 0]` không âm.

3. **Loại bỏ 100% rác Unity:**
   - Loại bỏ `nodeParameters_*` (chiếm 60.39% dung lượng), `childrenNames`, `parentName`.
   - Dung lượng giảm từ **600.7 KB xuống ~130.9 KB** (giảm 78.2%).

4. **Chống sinh ảnh rác:**
   - Bản cũ: Gán image cho khung cha rỗng.
   - Bản mới: Chỉ xuất ảnh cho visual leaf (RECTANGLE/ELLIPSE có fill/stroke) hoặc node có IMAGE fill. Khung cha có con không bao giờ sinh ảnh.

---

## 4. CHẠY BENCHMARK & TEST

```bash
# Chạy đo đạc hiệu năng và đối chiếu số đo
node bench.mjs

# Chạy bộ test tự động (node --test)
node --test test.mjs
```
