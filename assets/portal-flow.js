/* Slow fluid current behind the student portal. Colors are the page navy, blue and card teal. */
(() => {
  const canvas = document.getElementById("portal-flow");
  const portal = document.getElementById("portal-screen");
  if (!canvas || !portal) return;
  const view = canvas.getContext("2d", { alpha: false });
  const W = 200;
  const H = 112;
  const field = document.createElement("canvas");
  field.width = W;
  field.height = H;
  const pen = field.getContext("2d", { alpha: false });
  const dye = new Float32Array(W * H * 3);
  const next = new Float32Array(W * H * 3);
  const frame = pen.createImageData(W, H);
  const paper = [244 / 255, 246 / 255, 248 / 255];
  const inks = [
    [18 / 255, 49 / 255, 90 / 255],
    [8 / 255, 112 / 255, 108 / 255],
    [61 / 255, 108 / 255, 168 / 255]
  ];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0;
  let running = false;
  let last = 0;

  function fillPaper(buffer) {
    for (let i = 0; i < buffer.length; i += 3) {
      buffer[i] = paper[0];
      buffer[i + 1] = paper[1];
      buffer[i + 2] = paper[2];
    }
  }

  function sample(buffer, x, y) {
    const wx = ((x % W) + W) % W;
    const wy = ((y % H) + H) % H;
    const x0 = Math.floor(wx);
    const y0 = Math.floor(wy);
    const tx = wx - x0;
    const ty = wy - y0;
    const x1 = (x0 + 1) % W;
    const y1 = (y0 + 1) % H;
    const i00 = (y0 * W + x0) * 3;
    const i10 = (y0 * W + x1) * 3;
    const i01 = (y1 * W + x0) * 3;
    const i11 = (y1 * W + x1) * 3;
    const sx = 1 - tx;
    const sy = 1 - ty;
    return [
      buffer[i00] * sx * sy + buffer[i10] * tx * sy + buffer[i01] * sx * ty + buffer[i11] * tx * ty,
      buffer[i00 + 1] * sx * sy + buffer[i10 + 1] * tx * sy + buffer[i01 + 1] * sx * ty + buffer[i11 + 1] * tx * ty,
      buffer[i00 + 2] * sx * sy + buffer[i10 + 2] * tx * sy + buffer[i01 + 2] * sx * ty + buffer[i11 + 2] * tx * ty
    ];
  }

  function flow(x, y, time) {
    const nx = x / W;
    const ny = y / H;
    const a = Math.sin(nx * Math.PI * 2 * 1.15 + time * 0.22);
    const b = Math.cos(ny * Math.PI * 2 * 1.05 - time * 0.18);
    const c = Math.sin((nx * 1.4 + ny) * Math.PI * 2 + time * 0.13);
    return [(b + c * 0.65) * 0.46, (-a + c * 0.4) * 0.46];
  }

  function emitter(time, index) {
    const phase = index * 2.094;
    const x = W * (0.5 + 0.32 * Math.sin(time * (0.19 + index * 0.04) + phase) + 0.08 * Math.sin(time * 0.47 + index));
    const y = H * (0.48 + 0.28 * Math.cos(time * (0.16 + index * 0.03) + phase) + 0.07 * Math.cos(time * 0.37 + index));
    return [x, y];
  }

  function pour(time) {
    inks.forEach((ink, index) => {
      const [cx, cy] = emitter(time, index);
      const radius = 13 + index * 2;
      const reach = radius * radius;
      const x0 = Math.max(0, Math.floor(cx - radius));
      const x1 = Math.min(W - 1, Math.ceil(cx + radius));
      const y0 = Math.max(0, Math.floor(cy - radius));
      const y1 = Math.min(H - 1, Math.ceil(cy + radius));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = dx * dx + dy * dy;
          if (dist > reach) continue;
          const weight = Math.exp(-dist / (reach * 0.22)) * 0.11;
          const i = (y * W + x) * 3;
          dye[i] += (ink[0] - dye[i]) * weight;
          dye[i + 1] += (ink[1] - dye[i + 1]) * weight;
          dye[i + 2] += (ink[2] - dye[i + 2]) * weight;
        }
      }
    });
  }

  function advect(time, scale) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [vx, vy] = flow(x, y, time);
        const color = sample(dye, x - vx * scale, y - vy * scale);
        const i = (y * W + x) * 3;
        next[i] = color[0] * 0.991 + paper[0] * 0.009;
        next[i + 1] = color[1] * 0.991 + paper[1] * 0.009;
        next[i + 2] = color[2] * 0.991 + paper[2] * 0.009;
      }
    }
    dye.set(next);
  }

  function paint() {
    const pixels = frame.data;
    for (let i = 0, p = 0; i < dye.length; i += 3, p += 4) {
      pixels[p] = Math.max(0, Math.min(255, dye[i] * 255));
      pixels[p + 1] = Math.max(0, Math.min(255, dye[i + 1] * 255));
      pixels[p + 2] = Math.max(0, Math.min(255, dye[i + 2] * 255));
      pixels[p + 3] = 255;
    }
    pen.putImageData(frame, 0, 0);
    view.imageSmoothingEnabled = true;
    view.imageSmoothingQuality = "high";
    view.drawImage(field, 0, 0, canvas.width, canvas.height);
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }

  function tick(now) {
    if (!running) return;
    raf = window.requestAnimationFrame(tick);
    if (last && now - last < 32) return;
    const dt = last ? Math.min(50, now - last) : 32;
    last = now;
    const time = now * 0.001;
    pour(time);
    advect(time, dt / 28);
    paint();
  }

  function portalOpen() {
    return portal.style.display === "block" && !document.hidden;
  }

  function start() {
    if (running || reduce) return;
    running = true;
    last = 0;
    resize();
    raf = window.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  function sync() {
    if (portalOpen()) start();
    else stop();
  }

  fillPaper(dye);
  if (reduce) {
    pour(2.4);
    pour(2.4);
    pour(2.4);
  }
  resize();
  paint();
  new MutationObserver(sync).observe(portal, { attributes: true, attributeFilter: ["style"] });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", () => {
    resize();
    if (!running) paint();
  });
  sync();
})();
