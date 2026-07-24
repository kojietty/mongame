/**
 * render.js — ブラウザ専用のスプライト描画 + 待機/戦闘アニメーション。
 * engine.js の genSprite / spritePalette を canvas に描く。サーバーでは使わない。
 */

/** grid(48x48) を canvas ctx に 1px 単位で描画。blink=true で目を体色に */
export function drawSprite(ctx, grid, palette, blink = false) {
  const n = grid.length;
  ctx.clearRect(0, 0, n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let c = grid[y][x];
    if (!c) continue;
    if (blink && (c === 6 || c === 7)) c = 3;
    ctx.fillStyle = palette[c];
    ctx.fillRect(x, y, 1, 1);
  }
}

/**
 * 待機/戦闘アニメーター。呼吸(スカッシュ)、まばたき、攻撃ランジ、被弾シェイク+フラッシュ、撃破フェード。
 * requestAnimationFrame ループから frame(t) を呼ぶ。
 */
export class SpriteAnim {
  constructor(canvas, grid, palette, facing = 1) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.grid = grid; this.pal = palette; this.facing = facing;
    this.off = document.createElement("canvas");
    this.off.width = 48; this.off.height = 48;
    this.octx = this.off.getContext("2d");
    this.blink = false; this.lunge = 0; this.shake = 0; this.flash = 0;
    this.dead = false; this.deadT = 0; this.hop = 0;
    this.phase = Math.random() * 6.28;
    this._render(false);
  }
  _render(bl) { drawSprite(this.octx, this.grid, this.pal, bl); }
  hit() { this.shake = 1; this.flash = 1; }
  attack() { this.lunge = 1; }
  happy() { this.hop = 1; }
  die() { this.dead = true; }
  frame(t) {
    const ctx = this.ctx, W = this.cv.width, scale = W / 48;
    ctx.clearRect(0, 0, W, W);
    const blinkNow = Math.sin(t * 0.0013 + this.phase) > 0.985;
    if (blinkNow !== this.blink) { this.blink = blinkNow; this._render(this.blink); }
    const br = Math.sin(t * 0.003 + this.phase);
    let sy = 1 + br * 0.05, sx = 1 - br * 0.04, ox = 0, oy = 0, op = 1;
    if (this.hop > 0) { oy = -Math.sin((1 - this.hop) * Math.PI) * 14; this.hop = Math.max(0, this.hop - 0.06); }
    if (this.dead) { this.deadT += 0.06; sy = Math.max(0.05, 1 - this.deadT); op = Math.max(0, 1 - this.deadT); sx = 1 + this.deadT * 0.3; }
    if (this.lunge > 0) { ox += this.facing * this.lunge * 10; this.lunge = Math.max(0, this.lunge - 0.12); }
    if (this.shake > 0) { ox += (Math.random() - 0.5) * this.shake * 8; oy += (Math.random() - 0.5) * this.shake * 6; this.shake = Math.max(0, this.shake - 0.08); }
    ctx.save();
    ctx.globalAlpha = op;
    ctx.translate(W / 2 + ox * scale / 3, W - 6 * scale + oy * scale / 3);
    ctx.scale(scale * sx * this.facing, scale * sy);
    ctx.drawImage(this.off, -24, -48 + (1 - sy) * 10);
    ctx.restore();
    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = this.flash * 0.6;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, W);
      ctx.restore();
      this.flash = Math.max(0, this.flash - 0.1);
    }
  }
}
