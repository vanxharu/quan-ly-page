// So ảnh khách gửi (thường là ảnh chụp màn hình điện thoại có bài viết) với ảnh của từng bài trên trang khách.
// Ảnh bài nằm đâu đó bên trong ảnh chụp, có thể nhỏ hơn → trượt khung nhiều cỡ trên ảnh chụp, so "vân ảnh" (dHash 9×8 trên ảnh xám),
// lấy khoảng cách nhỏ nhất. Dùng ảnh tích phân để tính trung bình từng ô nhanh.
// Đầu vào: ảnh xám { w, h, px: Float32Array } (đã thu nhỏ). Hàm thuần, thử được không cần Electron.

function gray(bitmap, w, h, bgra = true) { // bitmap BGRA (Electron nativeImage.toBitmap) hoặc RGBA
  const px = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = bitmap[i * 4 + (bgra ? 2 : 0)], g = bitmap[i * 4 + 1], b = bitmap[i * 4 + (bgra ? 0 : 2)]; px[i] = 0.299 * r + 0.587 * g + 0.114 * b; }
  return { w, h, px };
}
function integral(img) {
  const { w, h, px } = img, I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += px[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  return { I, w, h };
}
const boxMean = (T, x0, y0, x1, y1) => { const W = T.w + 1; x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(T.w, Math.max(x0 + 1, Math.round(x1))); y1 = Math.min(T.h, Math.max(y0 + 1, Math.round(y1)));
  return (T.I[y1 * W + x1] - T.I[y0 * W + x1] - T.I[y1 * W + x0] + T.I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0)); };
// dHash 9×8 của một khung trong ảnh: 64 bit (mảng 0/1) + độ tương phản (khung phẳng một màu thì bỏ, tránh khớp nhầm nền trắng).
function hashBox(T, x, y, w, h) {
  const m = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 9; c++) m.push(boxMean(T, x + c * w / 9, y + r * h / 8, x + (c + 1) * w / 9, y + (r + 1) * h / 8));
  const bits = new Uint8Array(64); let k = 0, lo = Infinity, hi = -Infinity;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const a = m[r * 9 + c], b = m[r * 9 + c + 1]; bits[k++] = a > b ? 1 : 0; lo = Math.min(lo, a); hi = Math.max(hi, a); }
  return { bits, contrast: hi - lo };
}
const ham = (a, b) => { let d = 0; for (let i = 0; i < 64; i++) d += a[i] !== b[i]; return d; };
// Khoảng cách nhỏ nhất (0–64) giữa ảnh "needle" và mọi khung cùng tỉ lệ trên ảnh "hay". Càng nhỏ càng giống. ≤ 12 thường là cùng ảnh.
function bestDistance(hay, needle) {
  const H = integral(hay), N = integral(needle), nh = hashBox(N, 0, 0, needle.w, needle.h);
  if (nh.contrast < 8) return 64;
  const ratio = needle.h / needle.w; let best = 64;
  for (let fw = Math.round(hay.w * 0.18); fw <= hay.w; fw += Math.max(2, Math.round(hay.w * 0.03))) {
    const fh = fw * ratio; if (fh > hay.h) break;
    const step = Math.max(1, Math.round(fw / 14));
    for (let y = 0; y + fh <= hay.h; y += step) for (let x = 0; x + fw <= hay.w; x += step) {
      const b = hashBox(H, x, y, fw, fh); if (b.contrast < 8) continue;
      const d = ham(nh.bits, b.bits); if (d < best) { best = d; if (best === 0) return 0; }
    }
  }
  return best;
}
// So 2 ảnh đại diện (cả ảnh, không trượt khung): khoảng cách 0–64.
function wholeDistance(a, b) { const A = hashBox(integral(a), 0, 0, a.w, a.h), B = hashBox(integral(b), 0, 0, b.w, b.h); return ham(A.bits, B.bits); }
module.exports = { gray, bestDistance, wholeDistance, hashBox, integral };
