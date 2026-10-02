// 그림판: 펜 / 지우개 / 모두 지우기
window.Sketch = (() => {
  let canvas, ctx;
  let tool = 'pen';
  let drawing = false;
  let last = null;

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
  }

  function dot(p) {
    applyStyle();
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
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
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function setTool(t) {
    tool = t;
  }

  return { init, clear, setTool };
})();
