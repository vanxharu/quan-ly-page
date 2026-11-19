// node desktop/test/img-match.test.cjs — ảnh bài nằm trong ảnh chụp màn hình (thu nhỏ, có nhiễu) phải gần hơn hẳn ảnh khác.
const assert = require('assert'), { bestDistance } = require('../img-match');
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const photo = (w, h, f) => { const px = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = f(x / w, y / h); return { w, h, px }; };
const A = photo(80, 60, (u, v) => 128 + 100 * Math.sin(u * 9 + v * 3) * Math.cos(v * 7)), B = photo(80, 60, (u, v) => 128 + 100 * Math.cos(u * 4 - v * 11)), C = photo(80, 80, (u, v) => (u > .5) ^ (v > .5) ? 230 : 30);
const shot = { w: 200, h: 420, px: new Float32Array(200 * 420).fill(245) };
for (let i = 0; i < 40; i++) for (let x = 10; x < 190; x++) shot.px[(20 + i) * 200 + x] = 60 + rnd() * 20; // thanh tiêu đề
const put = (img, X, Y, W, H) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) shot.px[(Y + y) * 200 + X + x] = img.px[Math.floor(y / H * img.h) * img.w + Math.floor(x / W * img.w)] + (rnd() - .5) * 16; };
put(A, 20, 150, 112, 84); put(C, 20, 250, 70, 70);
const dA = bestDistance(shot, A), dB = bestDistance(shot, B), dC = bestDistance(shot, C);
console.log({ dA, dB, dC });
assert(dA <= 10, 'ảnh A nằm trong ảnh chụp'); assert(dC <= 10, 'ảnh C nằm trong ảnh chụp'); assert(dB >= dA + 10, 'ảnh B khác hẳn');
console.log('OK');
