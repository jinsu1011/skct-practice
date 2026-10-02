// 문제 영역 뷰어: PDF · 이미지 · 웹사이트(iframe) · 종이 책(안내 문구)
window.Viewer = (() => {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  let root, stage, pgInfo, zoomInfo;
  let mode = 'none';        // 'pages' | 'url' | 'none'
  let pdf = null;           // PDFDocumentProxy
  let images = [];          // HTMLImageElement[]
  let page = 1;
  let fit = 'width';        // 'width' | 'page'
  let zoom = 1;
  let token = 0;
  let renderTask = null;
  let renderedPage = 0;
  let currentUrl = '';

  function init() {
    root = document.getElementById('viewer');
    stage = document.getElementById('stage');
    pgInfo = document.getElementById('pg-info');
    zoomInfo = document.getElementById('zoom-info');

    document.getElementById('pg-prev').onclick = () => goTo(page - 1);
    document.getElementById('pg-next').onclick = () => goTo(page + 1);
    document.getElementById('zoom-in').onclick = () => setZoom(zoom * 1.2);
    document.getElementById('zoom-out').onclick = () => setZoom(zoom / 1.2);
    document.getElementById('fit-width').onclick = () => setFit('width');
    document.getElementById('fit-page').onclick = () => setFit('page');
    document.getElementById('url-reload').onclick = () => {
      const f = stage.querySelector('iframe');
      if (f) f.src = currentUrl;
    };
    document.getElementById('url-popup').onclick = openPopup;

    let t;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(render, 120);
    }).observe(stage);
  }

  // ---------- 자료 불러오기 ----------
  function reset() {
    if (pdf) pdf.destroy();
    pdf = null;
    images.forEach((img) => URL.revokeObjectURL(img.src));
    images = [];
    renderedPage = 0;
  }

  async function loadPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data }).promise;
    reset();
    pdf = doc;
    page = 1;
  }

  async function loadImages(files) {
    const loaded = await Promise.all(files.map((f) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`${f.name}을(를) 열 수 없습니다.`));
      img.src = URL.createObjectURL(f);
    })));
    reset();
    images = loaded;
    page = 1;
  }

  function pageCount() {
    if (pdf) return pdf.numPages;
    return images.length;
  }

  // ---------- 표시 ----------
  function setMode(m) {
    mode = m;
    root.dataset.mode = m;
  }

  function showPages(p) {
    if (mode !== 'pages') {
      stage.replaceChildren();
      renderedPage = 0;
    }
    setMode('pages');
    goTo(p);
  }

  function showUrl(url) {
    if (mode !== 'url' || url !== currentUrl) {
      currentUrl = url;
      const f = document.createElement('iframe');
      f.src = url;
      f.referrerPolicy = 'no-referrer-when-downgrade';
      f.allow = 'fullscreen; clipboard-read; clipboard-write';
      stage.replaceChildren(f);
    }
    setMode('url');
  }

  function showHtml(html) {
    setMode('none');
    stage.innerHTML = html;
  }

  function goTo(p) {
    const n = pageCount();
    if (!n) return;
    page = Math.min(Math.max(1, p), n);
    render();
  }

  function setZoom(z) {
    zoom = Math.min(4, Math.max(0.3, z));
    render();
  }

  function setFit(f) {
    fit = f;
    zoom = 1;
    document.getElementById('fit-width').classList.toggle('on', f === 'width');
    document.getElementById('fit-page').classList.toggle('on', f === 'page');
    render();
  }

  function baseScale(w, h) {
    const W = stage.clientWidth - 32;
    const H = stage.clientHeight - 32;
    return fit === 'width' ? W / w : Math.min(W / w, H / h);
  }

  async function render() {
    if (mode !== 'pages' || !pageCount() || root.hidden || stage.clientWidth < 40) return;
    const my = ++token;
    pgInfo.textContent = `${page} / ${pageCount()}`;
    zoomInfo.textContent = `${Math.round(zoom * 100)}%`;

    let el;
    if (pdf) {
      const pg = await pdf.getPage(page);
      if (my !== token) return;
      const v1 = pg.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const scale = baseScale(v1.width, v1.height) * zoom;
      const vp = pg.getViewport({ scale: scale * dpr });
      el = document.createElement('canvas');
      el.width = Math.floor(vp.width);
      el.height = Math.floor(vp.height);
      el.style.width = `${Math.floor(vp.width / dpr)}px`;
      if (renderTask) renderTask.cancel();
      renderTask = pg.render({ canvasContext: el.getContext('2d'), viewport: vp });
      try {
        await renderTask.promise;
      } catch {
        return; // 더 새로운 렌더링으로 취소됨
      }
      if (my !== token) return;
    } else {
      const src = images[page - 1];
      const scale = baseScale(src.naturalWidth, src.naturalHeight) * zoom;
      el = src.cloneNode();
      el.style.width = `${Math.floor(src.naturalWidth * scale)}px`;
      el.alt = `${page}쪽`;
    }

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.append(el);
    const keepScroll = renderedPage === page;
    const { scrollTop, scrollLeft } = stage;
    stage.replaceChildren(wrap);
    if (keepScroll) {
      stage.scrollTop = scrollTop;
      stage.scrollLeft = scrollLeft;
    } else {
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
    }
    renderedPage = page;
  }

  function openPopup() {
    if (!currentUrl) return;
    const w = Math.round(screen.availWidth * 0.7);
    const h = screen.availHeight;
    window.open(currentUrl, 'skct_source', `left=0,top=0,width=${w},height=${h}`);
  }

  return { init, loadPdf, loadImages, pageCount, showPages, showUrl, showHtml, goTo, render };
})();
