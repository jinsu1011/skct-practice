// 그림판: 펜 / 지우개 / 모두 지우기
window.Sketch = (() => {
  let canvas, ctx;
  let tool = 'pen';
  let drawing = false;
  let last = null;
  let box = null;   // 그린 영역 (화면 px) — 저장할 때 이 부분만 잘라 용량을 줄인다

  function grow(p) {
    const r = ctx.lineWidth;
    box = box
      ? { x1: Math.min(box.x1, p.x - r), y1: Math.min(box.y1, p.y - r), x2: Math.max(box.x2, p.x + r), y2: Math.max(box.y2, p.y + r) }
      : { x1: p.x - r, y1: p.y - r, x2: p.x + r, y2: p.y + r };
  }

  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    new ResizeObserver(resize).observe(canvas);

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      last = point(e);
      dot(last);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = point(e);
      line(last, p);
      last = p;
    });
    const end = () => { drawing = false; last = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function applyStyle() {
    const eraser = tool === 'eraser';
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = '#1b1b1b';
    ctx.lineWidth = eraser ? 22 : 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function line(a, b) {
    applyStyle();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (tool === 'pen') { grow(a); grow(b); }
  }

  function dot(p) {
    applyStyle();
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    if (tool === 'pen') grow(p);
  }

  // 크기가 바뀌어도 그린 내용은 유지
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (w === canvas.width && h === canvas.height) return;

    const snap = document.createElement('canvas');
    snap.width = canvas.width;
    snap.height = canvas.height;
    snap.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = w;
    canvas.height = h;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(snap, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clear() {
    box = null;
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function setTool(t) {
    tool = t;
  }

  // 그린 부분만 흰 바탕 이미지로 (최대 480×360, WebP 또는 JPEG). 그린 게 없으면 null
  function snapshot() {
    if (!box || !canvas.width) return null;
    const cssW = canvas.getBoundingClientRect().width || canvas.width;
    const k = canvas.width / cssW;
    const pad = 8;
    const x1 = Math.max(0, (box.x1 - pad) * k);
    const y1 = Math.max(0, (box.y1 - pad) * k);
    const x2 = Math.min(canvas.width, (box.x2 + pad) * k);
    const y2 = Math.min(canvas.height, (box.y2 + pad) * k);
    if (x2 - x1 < 2 || y2 - y1 < 2) return null;
    const w = (x2 - x1) / k;
    const h = (y2 - y1) / k;
    const scale = Math.min(1, 480 / w, 360 / h);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    const c = out.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(canvas, x1, y1, x2 - x1, y2 - y1, 0, 0, out.width, out.height);
    let url = out.toDataURL('image/webp', 0.6);
    if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/jpeg', 0.7);
    return url.length <= 60000 ? url : out.toDataURL('image/jpeg', 0.4);
  }

  return { init, clear, setTool, snapshot };
})();
