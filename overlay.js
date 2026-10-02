// SKCT 시험모드 (북마크 버튼으로 실행)
// 지금 보고 있는 페이지(예: 로그인한 링커리어 문제 페이지)를 그대로 문제 영역에 넣고
// 그 위에 시험 화면(타이머·선지·메모장·그림판·계산기)을 씌운다.
// 같은 사이트 안에서 페이지를 다시 띄우는 것이라 로그인 상태가 유지된다.
(() => {
  if (window.__skctOverlay) {
    window.__skctOverlay.show();
    return;
  }

  const BASE = new URL('.', document.currentScript.src).href;
  const VERSION = '15';
  const SECTIONS = ['언어이해', '자료해석', '창의수리', '언어추리', '수열추리'];
  const SAMPLE_SEC = 60;
  const pageUrl = location.href;

  const loadScript = (path) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${BASE}${path}?v=${VERSION}`;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${path}을(를) 불러오지 못했습니다.`));
    document.head.append(s);
  });

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

  // ---------- 화면 뼈대 (Shadow DOM으로 페이지 스타일과 분리) ----------
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap';
  document.head.append(font);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('skct-overlay')) || {}; } catch { return {}; }
  })();

  root.innerHTML = `
    <link rel="stylesheet" href="${BASE}css/style.css?v=${VERSION}">
    <style>
      :host { all: initial; }
      .ov { position: fixed; inset: 0; font-family: 'Noto Sans KR', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
            font-size: 16px; line-height: normal; color: var(--ink); -webkit-font-smoothing: antialiased; visibility: hidden; }
      .ov.ready { visibility: visible; }
      .ov-layer { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; overflow: auto; background: rgba(20, 20, 24, .55); }
      .ov-card { width: min(440px, 100%); padding: 28px; border-radius: 14px; background: #fff; box-shadow: 0 16px 50px rgba(0, 0, 0, .3); }
      .ov-card.wide { width: min(820px, 100%); }
      .ov-card h2 { margin: 10px 0 6px; font-size: 22px; }
      .ov-card > .muted { font-size: 14px; line-height: 1.6; margin-bottom: 18px; }
      .ov-card select, .ov-card input[type=number] { height: 42px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; font-size: 15px; font-weight: 400; }
      .ov-card .row2 { margin-top: 12px; }
      .chk { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 14px; }
      .chk input { width: 17px; height: 17px; accent-color: var(--red); }
      .ov-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; flex-wrap: wrap; }
      .ov-sum { margin: 4px 0 16px; color: var(--muted); font-size: 14px; }
      .ov .screen.active { position: absolute; inset: 0; background: #fff; }
      .ov .r-grid { max-height: 46vh; overflow: auto; }
    </style>
    <div class="ov">
      <div class="ov-layer" id="o-setup">
        <div class="ov-card">
          <span class="auth-badge">SKCT 시험모드</span>
          <h2>이 페이지로 시험 보기</h2>
          <p class="muted">지금 보고 있는 페이지가 시험 화면의 문제 영역에 그대로 들어갑니다. 로그인 상태도 유지됩니다.</p>
          <label class="field">영역
            <select id="o-sec">${SECTIONS.map((s) => `<option ${saved.section === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          </label>
          <div class="row2">
            <label class="field">문항 수<input type="number" id="o-count" min="1" max="100" value="${saved.count || 20}"></label>
            <label class="field">시간(분)<input type="number" id="o-time" min="1" max="180" value="${saved.time || 15}"></label>
          </div>
          <label class="chk"><input type="checkbox" id="o-sample" ${saved.sample === false ? '' : 'checked'}> 시작 전 1분 유형 예시 보기</label>
          <div class="ov-actions">
            <button type="button" class="btn" id="o-close">닫기</button>
            <button type="button" class="btn primary" id="o-start">시험 시작</button>
          </div>
        </div>
      </div>

      <section id="screen-exam" class="screen">
        <header class="topbar">
          <div class="tb-left" id="exam-title"></div>
          <div class="tb-center"><span class="tl-label" id="exam-timer-label">남은 시간</span><span class="tl-time" id="exam-timer">00:00</span></div>
          <div class="tb-right">
            <button type="button" id="btn-pause" class="tb-btn">일시정지</button>
            <button type="button" id="btn-reset" class="tb-btn">시간 초기화</button>
            <button type="button" id="btn-quit" class="tb-btn">시험모드 종료</button>
          </div>
        </header>
        <div class="progress off" id="progress">
          <div class="progress-count" id="progress-count"></div>
          <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
        </div>
        <div class="exam-body">
          <div class="exam-main">
            <div class="q-area">
              <div id="sample-area" class="sample" hidden></div>
              <div id="viewer" class="viewer" data-mode="url">
                <div class="viewer-bar">
                  <div class="vb-group" data-for="url">
                    <button type="button" id="url-reload">처음 페이지로</button>
                    <span class="vb-text muted">문제 영역 안에서 스크롤·페이지 이동이 그대로 됩니다.</span>
                  </div>
                </div>
                <div class="stage" id="stage"></div>
              </div>
            </div>
            <div class="answer-bar">
              <div class="choices" id="choices"></div>
              <button type="button" id="btn-next" class="btn primary next">다음</button>
            </div>
          </div>
          <aside class="tools">
            <div class="panel pad">
              <div class="tabs" id="pad-tabs">
                <button type="button" data-tab="memo" class="on">메모장</button>
                <button type="button" data-tab="draw">그림판</button>
              </div>
              <textarea id="memo" placeholder="메모를 입력하세요" spellcheck="false"></textarea>
              <div id="draw-wrap" class="draw-wrap" hidden>
                <div class="draw-tools">
                  <button type="button" data-tool="pen" class="on">펜</button>
                  <button type="button" data-tool="eraser">지우개</button>
                  <button type="button" data-tool="clear">모두 지우기</button>
                </div>
                <div class="draw-box"><canvas id="draw"></canvas></div>
              </div>
            </div>
            <div class="panel calc" id="calc" tabindex="0" aria-label="계산기"></div>
          </aside>
        </div>
      </section>

      <div class="ov-layer" id="o-end" hidden>
        <div class="ov-card wide">
          <span class="auth-badge">검사 종료</span>
          <h2>수고하셨습니다</h2>
          <p class="ov-sum" id="o-sum"></p>
          <div class="r-grid" id="o-grid"></div>
          <p class="hint"><b>[저장하고 채점하기]</b>를 누르면 SKCT 연습 사이트가 새 탭으로 열리고, 로그인한 계정에 기록이 저장됩니다. 거기서 정답을 입력해 채점하세요.</p>
          <div class="ov-actions">
            <button type="button" class="btn" id="o-copy">답안 복사</button>
            <button type="button" class="btn" id="o-again">다시 풀기</button>
            <button type="button" class="btn" id="o-close2">닫기</button>
            <button type="button" class="btn primary" id="o-save">저장하고 채점하기</button>
          </div>
        </div>
      </div>

      <div id="modal" class="modal" hidden>
        <div class="modal-box" role="dialog" aria-modal="true">
          <h3 id="modal-title"></h3>
          <div id="modal-body" class="modal-body"></div>
          <div id="modal-btns" class="modal-btns"></div>
        </div>
      </div>
      <div id="toast" class="toast" hidden></div>
    </div>`;

  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.append(host);
  document.documentElement.style.overflow = 'hidden';
  $('link[rel=stylesheet]').addEventListener('load', () => $('.ov').classList.add('ready'));
  setTimeout(() => $('.ov').classList.add('ready'), 1500);

  // ---------- 팝업 / 토스트 ----------
  let modalResolve = null;
  function modal({ title, body, buttons }) {
    closeModal(undefined);
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    $('#modal-btns').replaceChildren(...buttons.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `btn${b.primary ? ' primary' : ''}`;
      el.textContent = b.label;
      el.onclick = () => closeModal(b.value);
      return el;
    }));
    $('#modal').hidden = false;
    return new Promise((r) => { modalResolve = r; });
  }
  function closeModal(v) {
    if (!modalResolve) return;
    $('#modal').hidden = true;
    const r = modalResolve;
    modalResolve = null;
    r(v);
  }
  let toastTimer;
  function toast(msg) {
    $('#toast').textContent = msg;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2000);
  }

  // ---------- 상태 ----------
  const S = { phase: 'setup', sec: null, q: 0, answers: [], times: [], notes: [], qStart: 0, sampleAnswer: null, busy: false, result: null, saved: true };
  const unsaved = () => S.phase === 'end' && !S.saved;
  const T = { total: 0, left: 0, end: 0, onDone: null, paused: false, warn: false };
  let countdown = null;

  function tick() {
    if (!T.paused) T.left = Math.max(0, (T.end - Date.now()) / 1000);
    const left = Math.ceil(T.left);
    const el = $('#exam-timer');
    el.textContent = mmss(left);
    el.classList.toggle('warn', T.warn && !T.paused && left <= 60);
    el.classList.toggle('paused', T.paused);
    if (left <= 0 && !T.paused) {
      stopCountdown();
      T.onDone();
    }
  }
  function runCountdown() {
    clearInterval(countdown);
    T.end = Date.now() + T.left * 1000;
    tick();
    countdown = setInterval(tick, 200);
  }
  function stopCountdown() {
    clearInterval(countdown);
    countdown = null;
  }
  function startCountdown(sec, onDone, warn) {
    stopCountdown();
    Object.assign(T, { total: sec, left: sec, onDone, warn, paused: false });
    paintPause();
    runCountdown();
  }
  function paintPause() {
    $('#btn-pause').textContent = T.paused ? '계속' : '일시정지';
    $('#btn-pause').classList.toggle('on', T.paused);
    $('#exam-timer-label').textContent = T.paused ? '일시정지' : '남은 시간';
  }
  function recordTime() {
    if (S.phase !== 'test' || T.paused) return;
    const now = Date.now();
    S.times[S.q] += (now - S.qStart) / 1000;
    S.qStart = now;
  }

  // ---------- 화면 ----------
  function showLayer(which) {
    $('#o-setup').hidden = which !== 'setup';
    $('#o-end').hidden = which !== 'end';
    $('#screen-exam').classList.toggle('active', which === 'exam');
  }

  function clearTools() {
    $('#memo').value = '';
    window.Sketch?.clear();
  }

  function renderChoices(texts) {
    $('#choices').innerHTML = [1, 2, 3, 4, 5].map((n) => `
      <button type="button" class="choice" data-n="${n}"><span class="cn">${n}</span>${texts ? `<span class="ct">${esc(texts[n - 1])}</span>` : ''}</button>`).join('');
  }
  function paintChoices(sel) {
    $$('#choices .choice').forEach((b) => b.classList.toggle('sel', +b.dataset.n === sel));
  }
  function setProgress(n, total) {
    $('#progress').classList.toggle('off', !total);
    $('#progress-count').textContent = `${n} / ${total}`;
    $('#progress-fill').style.width = total ? `${(n / total) * 100}%` : '0';
  }

  function ensureFrame() {
    if ($('#stage iframe')) return;
    const f = document.createElement('iframe');
    // 최상위 이동(프레임 탈출)만 막고 나머지는 원래 페이지처럼 동작
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
    f.src = pageUrl;
    $('#stage').append(f);
  }

  function start() {
    const sec = $('#o-sec').value;
    const count = clamp(parseInt($('#o-count').value, 10), 1, 100);
    const time = clamp(parseInt($('#o-time').value, 10), 1, 180);
    const sample = $('#o-sample').checked;
    try { localStorage.setItem('skct-overlay', JSON.stringify({ section: sec, count, time, sample })); } catch { /* 저장 불가 */ }

    S.sec = { name: sec, count, time };
    $('#o-save').textContent = '저장하고 채점하기';
    S.answers = Array(count).fill(null);
    S.times = Array(count).fill(0);
    S.notes = [];
    ensureFrame();
    showLayer('exam');
    document.documentElement.requestFullscreen?.().catch(() => {});
    if (sample && window.SAMPLES?.[sec]) startSample();
    else startTest();
  }

  function startSample() {
    const sm = window.SAMPLES[S.sec.name];
    S.phase = 'sample';
    S.sampleAnswer = null;
    $('#exam-title').textContent = `${S.sec.name} · 유형 예시`;
    $('#viewer').hidden = true;
    const area = $('#sample-area');
    area.hidden = false;
    area.innerHTML = `
      <div class="sample-banner">유형 예시 문항입니다. 1분 후 본 검사가 자동으로 시작됩니다. (채점되지 않음)</div>
      <p class="sample-guide">${sm.guide}</p>
      <div class="sample-q">${sm.html}</div>
      <details class="sample-ans"><summary>정답 보기</summary><p>정답 ${sm.answer}번 — ${sm.explain}</p></details>`;
    setProgress(0, 0);
    renderChoices(sm.choices);
    $('#btn-next').textContent = '본 검사 시작';
    clearTools();
    startCountdown(SAMPLE_SEC, startTest, false);
  }

  function startTest() {
    closeModal(false);
    S.phase = 'test';
    S.q = 0;
    $('#exam-title').textContent = S.sec.name;
    $('#sample-area').hidden = true;
    $('#viewer').hidden = false;
    renderChoices(null);
    showQuestion();
    startCountdown(S.sec.time * 60, () => finish('timeup'), true);
  }

  function showQuestion() {
    setProgress(S.q + 1, S.sec.count);
    paintChoices(S.answers[S.q]);
    $('#btn-next').textContent = S.q === S.sec.count - 1 ? '제출' : '다음';
    clearTools();
    S.qStart = Date.now();
  }

  async function next() {
    if (S.phase === 'sample') return startTest();
    if (S.phase !== 'test' || S.busy) return;
    const isLast = S.q === S.sec.count - 1;
    S.busy = true;
    try {
      if (isLast) {
        const empty = S.answers.filter((a) => a == null).length;
        const ok = await modal({
          title: '답안 제출',
          body: `<p>마지막 문항입니다. 제출하면 답안을 더 이상 수정할 수 없습니다.</p>${empty ? `<p class="red">선택하지 않은 문항 ${empty}개는 미응답으로 처리됩니다.</p>` : ''}<p>답안을 제출하시겠습니까?</p>`,
          buttons: [{ label: '취소', value: false }, { label: '제출', value: true, primary: true }],
        });
        if (ok && S.phase === 'test') finish('submit');
      } else {
        if (S.answers[S.q] == null) {
          const ok = await modal({
            title: '답안을 선택하지 않았습니다',
            body: '<p>다음 문항으로 넘어가면 <b>이 문항으로 다시 돌아올 수 없으며</b>, 미응답으로 처리됩니다.</p><p>답을 선택하지 않고 넘어가시겠습니까?</p>',
            buttons: [{ label: '취소', value: false }, { label: '넘어가기', value: true, primary: true }],
          });
          if (!ok || S.phase !== 'test') return;
        }
        captureNote();
        recordTime();
        S.q += 1;
        showQuestion();
      }
    } finally {
      S.busy = false;
    }
  }

  function captureNote() {
    if (S.phase !== 'test') return;
    const memo = $('#memo').value.trim().slice(0, 2000);
    const img = window.Sketch?.snapshot() || null;
    if (memo || img) S.notes[S.q] = { q: S.q, memo, img };
  }

  async function finish(reason) {
    captureNote();
    recordTime();
    stopCountdown();
    S.phase = 'end';
    closeModal(false);
    if (reason === 'timeup') {
      await modal({ title: '시간 종료', body: '<p>제한 시간이 끝나 답안이 자동으로 제출되었습니다.</p>', buttons: [{ label: '확인', value: true, primary: true }] });
    }
    const times = S.times.map((t) => Math.round(t));
    S.saved = false;
    S.result = {
      date: new Date().toISOString(),
      source: pageUrl,
      external: true,
      sections: [{
        name: S.sec.name, count: S.sec.count, time: S.sec.time,
        used: Math.min(times.reduce((a, b) => a + b, 0), S.sec.time * 60), answers: S.answers, times,
        notes: S.notes.filter(Boolean),
      }],
    };
    const answered = S.answers.filter((a) => a != null).length;
    $('#o-sum').textContent = `${S.sec.name} · 응답 ${answered} / ${S.sec.count} · 사용 시간 ${mmss(S.result.sections[0].used)}`;
    $('#o-grid').innerHTML = S.answers.map((a, i) => `
      <div class="cell"><span class="no">${i + 1}</span>${a ? `<span class="ans">${'①②③④⑤'[a - 1]}</span>` : '<span class="ans none">미응답</span>'}<span class="t">${times[i] ? `${times[i]}초` : '-'}</span></div>`).join('');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    showLayer('end');
  }

  // 저장하지 않은 기록을 버리기 전에 확인
  async function confirmDiscard() {
    if (!unsaved()) return true;
    return modal({
      title: '저장하지 않은 기록',
      body: '<p>방금 푼 기록을 아직 저장하지 않았습니다.</p><p class="red">저장하지 않고 닫으면 기록이 사라집니다.</p>',
      buttons: [{ label: '취소', value: false }, { label: '저장하지 않고 닫기', value: true, primary: true }],
    });
  }

  async function quit() {
    if (!(await confirmDiscard())) return;
    if (S.phase === 'sample' || S.phase === 'test') {
      const ok = await modal({
        title: '시험모드 종료',
        body: '<p>시험을 중단하고 시험모드를 닫으시겠습니까?</p><p class="red">지금까지 선택한 답안은 저장되지 않습니다.</p>',
        buttons: [{ label: '취소', value: false }, { label: '종료', value: true, primary: true }],
      });
      if (!ok) return;
    }
    stopCountdown();
    S.phase = 'setup';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    host.remove();
    document.documentElement.style.overflow = prevOverflow;
    window.removeEventListener('beforeunload', onLeave);
  }

  // 시험 중이거나 저장하지 않은 기록이 있으면 페이지를 떠나기 전에 브라우저가 확인
  function onLeave(e) {
    if (S.phase === 'sample' || S.phase === 'test' || unsaved()) {
      e.preventDefault();
      e.returnValue = '';
    }
  }

  function show() {
    if (!host.isConnected) {
      document.documentElement.append(host);
      document.documentElement.style.overflow = 'hidden';
      window.addEventListener('beforeunload', onLeave);
    }
    if (S.phase === 'setup') showLayer('setup');
  }

  // ---------- 이벤트 ----------
  $('#o-start').onclick = start;
  $('#o-close').onclick = quit;
  $('#o-close2').onclick = quit;
  $('#btn-quit').onclick = quit;
  $('#btn-next').onclick = next;
  $('#o-again').onclick = async () => {
    if (!(await confirmDiscard())) return;
    S.phase = 'setup';
    S.saved = true;
    showLayer('setup');
  };
  // 사이트 탭이 열리면 'skct-import-ready'를 보내오고, 그때 기록(메모·그림 포함)을 넘겨준다
  const siteOrigin = new URL(BASE).origin;
  window.addEventListener('message', (e) => {
    if (e.origin !== siteOrigin || e.data?.type !== 'skct-import-ready' || !S.result) return;
    e.source.postMessage({ type: 'skct-import', result: S.result }, siteOrigin);
  });

  $('#o-save').onclick = () => {
    // 주소에는 그림을 뺀 기록만 담고(msg 표시), 그림은 새 탭이 요청하면 메시지로 보낸다
    const light = {
      ...S.result,
      msg: true,
      sections: S.result.sections.map((s) => ({ ...s, notes: (s.notes || []).map((n) => ({ ...n, img: null })) })),
    };
    const tab = window.open(`${BASE}#import=${encodeURIComponent(JSON.stringify(light))}`, '_blank');
    if (!tab) {
      toast('팝업이 차단되었습니다. 주소창 오른쪽에서 팝업을 허용한 뒤 다시 눌러 주세요.');
      return;
    }
    S.saved = true;
    $('#o-save').textContent = '저장 완료 ✓';
    toast('새 탭에서 SKCT 연습 사이트가 열리고 기록이 저장됩니다.');
  };
  $('#o-copy').onclick = async () => {
    const s = S.result.sections[0];
    try {
      await navigator.clipboard.writeText(`[SKCT 연습 답안] ${s.name}\n${s.answers.map((a, i) => `${i + 1}:${a ?? '-'}`).join('  ')}`);
      toast('답안을 복사했습니다.');
    } catch {
      toast('복사하지 못했습니다.');
    }
  };
  $('#url-reload').onclick = () => { const f = $('#stage iframe'); if (f) f.src = pageUrl; };
  $('#btn-pause').onclick = () => {
    if (!['sample', 'test'].includes(S.phase)) return;
    if (T.paused) {
      T.paused = false;
      S.qStart = Date.now();
      runCountdown();
    } else {
      recordTime();
      tick();
      T.paused = true;
      stopCountdown();
      tick();
    }
    paintPause();
  };
  $('#btn-reset').onclick = () => {
    if (!['sample', 'test'].includes(S.phase)) return;
    T.left = T.total;
    if (T.paused) tick();
    else runCountdown();
  };
  $('#choices').addEventListener('click', (e) => {
    const b = e.target.closest('.choice');
    if (!b) return;
    const n = +b.dataset.n;
    if (S.phase === 'sample') {
      S.sampleAnswer = S.sampleAnswer === n ? null : n;
      paintChoices(S.sampleAnswer);
    } else if (S.phase === 'test') {
      S.answers[S.q] = S.answers[S.q] === n ? null : n;
      paintChoices(S.answers[S.q]);
    }
  });
  $('#pad-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    $$('#pad-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    const draw = b.dataset.tab === 'draw';
    $('#memo').hidden = draw;
    $('#draw-wrap').hidden = !draw;
  });
  $('.draw-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tool]');
    if (!b) return;
    if (b.dataset.tool === 'clear') return window.Sketch?.clear();
    $$('.draw-tools button[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
    window.Sketch?.setTool(b.dataset.tool);
  });
  // 시험모드 안에서 누른 키가 원래 페이지 단축키로 새지 않게
  host.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' && modalResolve && $('#modal-btns').children.length > 1) closeModal(false);
  });
  window.addEventListener('beforeunload', onLeave);

  // 계산기 · 그림판 · 유형 예시 문항은 사이트의 스크립트를 그대로 사용
  Promise.all(['js/samples.js', 'js/calc.js', 'js/sketch.js'].map(loadScript))
    .then(() => {
      window.Calc.init($('#calc'));
      window.Sketch.init($('#draw'));
    })
    .catch((err) => toast(err.message));

  showLayer('setup');
  window.__skctOverlay = { show };
})();
