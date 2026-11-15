type Box = [number, number, number, number];

export const trackingWidth = 80;
export const trackingHeight = 60;

function overlapsAny(
  bx: number,
  by: number,
  bw: number,
  bh: number,
  excluded: Box[],
  threshold = 0.12
): boolean {
  for (let i = 0; i < excluded.length; i++) {
    const [ax, ay, aw, ah] = excluded[i];
    const ix = Math.max(0, Math.min(bx + bw, ax + aw) - Math.max(bx, ax));
    const iy = Math.max(0, Math.min(by + bh, ay + ah) - Math.max(by, ay));
    const inter = ix * iy;
    if (inter > 0 && inter / (bw * bh) >= threshold) {
      return true;
    }
  }
  return false;
}

export class UnknownItemTracking {
  private previous?: Uint8ClampedArray;
  private target?: { box: Box; image: Uint8ClampedArray };
  private candidate?: Box;
  private misses = 0;

  update(image: Uint8ClampedArray, excluded: Box[]): Box | undefined {
    const previous = this.previous;
    this.previous = image;
    const width = trackingWidth, height = trackingHeight;
    const blocked = (x: number, y: number) => excluded.some(([a, b, w, h]) =>
      x >= a && y >= b && x < a + w && y < b + h);
    if (this.target) {
      const { box: [x, y, w, h], image: reference } = this.target;
      if (overlapsAny(x, y, w, h, excluded, 0.12)) {
        this.target = undefined;
        this.candidate = undefined;
        this.misses = 0;
        return undefined;
      }
      let best: Box | undefined;
      let bestError = 23;
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const left = x + dx, top = y + dy;
          if (left < 0 || top < 0 || left + w > width || top + h > height ||
              blocked(left + w / 2, top + h / 2) ||
              overlapsAny(left, top, w, h, excluded, 0.12)) continue;
          let error = 0, samples = 0;
          for (let row = 1; row < h; row += 2) {
            for (let col = 1; col < w; col += 2) {
              error += Math.abs(reference[(y + row) * width + x + col] - image[(top + row) * width + left + col]);
              samples++;
            }
          }
          error = error / samples + Math.hypot(dx, dy) * .12;
          if (error < bestError) {
            bestError = error;
            best = [left, top, w, h];
          }
        }
      }
      if (best) {
        if (overlapsAny(best[0], best[1], best[2], best[3], excluded, 0.12)) {
          this.target = undefined;
          this.candidate = undefined;
          this.misses = 0;
          return undefined;
        }
        this.misses = 0;
        if (bestError < 12) this.target = { box: best, image };
        else {
          // Keep a reliable template during short periods of blur or occlusion.
          return best;
        }
        return best;
      }
      if (++this.misses < 5) return;
      this.target = undefined;
      this.misses = 0;
      this.candidate = undefined;
    }
    if (!previous) return;

    // Group adjacent changed tiles so separate movement does not produce one large box.
    const tile = 4, columns = width / tile, rows = height / tile;
    const moving = new Set<number>();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        if (blocked(col * tile + 2, row * tile + 2)) continue;
        let difference = 0;
        for (let y = 0; y < tile; y++) {
          for (let x = 0; x < tile; x++) {
            const index = (row * tile + y) * width + col * tile + x;
            difference += Math.abs(image[index] - previous[index]);
          }
        }
        if (difference > 18 * tile * tile) moving.add(row * columns + col);
      }
    }
    let best: Box | undefined, bestSize = 0;
    while (moving.size) {
      const first = moving.values().next().value!;
      const queue = [first];
      moving.delete(first);
      let left = columns, right = 0, top = rows, bottom = 0;
      for (const index of queue) {
        const col = index % columns, row = Math.floor(index / columns);
        left = Math.min(left, col);
        right = Math.max(right, col);
        top = Math.min(top, row);
        bottom = Math.max(bottom, row);
        const neighbors = [index - columns, index + columns];
        if (col > 0) neighbors.push(index - 1);
        if (col < columns - 1) neighbors.push(index + 1);
        for (const neighbor of neighbors) if (moving.delete(neighbor)) queue.push(neighbor);
      }
      const w = right - left + 1, h = bottom - top + 1;
      const boxLeft = left * tile, boxTop = top * tile, boxW = w * tile, boxH = h * tile;
      if (w < 2 || h < 2 || w > 11 || h > 10 || queue.length < 5 || queue.length <= bestSize ||
          overlapsAny(boxLeft, boxTop, boxW, boxH, excluded, 0.12)) continue;
      bestSize = queue.length;
      best = [boxLeft, boxTop, boxW, boxH];
    }
    const prior = this.candidate;
    this.candidate = best;
    if (best && prior && Math.abs(best[0] - prior[0]) < 16 && Math.abs(best[1] - prior[1]) < 16 &&
        !blocked(best[0] + best[2] / 2, best[1] + best[3] / 2) &&
        !overlapsAny(best[0], best[1], best[2], best[3], excluded, 0.12)) {
      this.target = { box: best, image };
      return best;
    }
  }
}
