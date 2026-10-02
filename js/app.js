(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const CIRCLED = ['', '①', '②', '③', '④', '⑤'];
  const WAIT_SEC = 60;
  const SAMPLE_SEC = 60;
  const SECTION_NAMES = ['언어이해', '자료해석', '창의수리', '언어추리', '수열추리'];

  const store = {
    get(k) {
      try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ }
    },
  };

  const saved = store.get('skct-settings') || {};
  const S = {
    mode: ['file', 'url', 'none'].includes(saved.mode) ? saved.mode : 'file',
    url: saved.url || '',
    sections: SECTION_NAMES.map((name) => ({
      name, on: true, count: 20, time: 15, start: 1, perPage: 0, url: '',
      ...((saved.sections || []).find((s) => s.name === name) || {}),
    })),
    plan: [],
    si: 0,
    q: 0,
    phase: 'setup',   // setup | wait | sample | test | between | end
    answers: [],
    times: [],
    qStart: 0,
    sampleAnswer: null,
    busy: false,
    result: null,
  };

  const saveSettings = () => store.set('skct-settings', { mode: S.mode, url: S.url, sections: S.sections });
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
  const mmss = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalizeUrl = (u) => {
    u = (u || '').trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : `https://${u}`;
  };

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${id}`));
    window.scrollTo(0, 0);
  }

  // ---------- 팝업 ----------
  let modalResolve = null;

  function modal({ title, body, buttons }) {
    closeModal(undefined);
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    const box = $('#modal-btns');
    box.replaceChildren(...buttons.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `btn${b.primary ? ' primary' : ''}`;
      el.textContent = b.label;
      el.onclick = () => closeModal(b.value);
      return el;
    }));
    $('#modal').hidden = false;
    box.lastElementChild.focus();
    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function closeModal(value) {
    if (!modalResolve) return;
    $('#modal').hidden = true;
    const r = modalResolve;
    modalResolve = null;
    r(value);
  }

  const alertModal = (title, body) => modal({ title, body, buttons: [{ label: '확인', value: true, primary: true }] });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalResolve && $('#modal-btns').children.length > 1) closeModal(false);
  });

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }

  // ---------- 타이머 ----------
  let countdown = null;

  function startCountdown(seconds, els, onDone, warn = false) {
    stopCountdown();
    const end = Date.now() + seconds * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      els.forEach((el) => {
        el.textContent = mmss(left);
        el.classList.toggle('warn', warn && left <= 60);
      });
      if (left <= 0) {
        stopCountdown();
        onDone();
      }
    };
    tick();
    countdown = setInterval(tick, 200);
  }

  function stopCountdown() {
    clearInterval(countdown);
    countdown = null;
  }

  // ---------- ① 설정 ----------
  function setMode(m) {
    S.mode = m;
    $$('#src-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $$('.src-pane').forEach((p) => { p.hidden = p.dataset.pane !== m; });
    $('#sec-table').dataset.mode = m;
    saveSettings();
  }

  function renderRows() {
    $('#sec-rows').innerHTML = S.sections.map((s, i) => `
      <tr class="${s.on ? '' : 'off'}">
        <td><input type="checkbox" data-i="${i}" data-k="on" ${s.on ? 'checked' : ''} aria-label="${s.name} 응시"></td>
        <td class="nm">${s.name}</td>
        <td><input type="number" min="1" max="100" data-i="${i}" data-k="count" value="${s.count}"></td>
        <td><input type="number" min="1" max="180" data-i="${i}" data-k="time" value="${s.time}"></td>
        <td class="c-file"><input type="number" min="1" data-i="${i}" data-k="start" value="${s.start}"></td>
        <td class="c-file"><input type="number" min="0" max="20" data-i="${i}" data-k="perPage" value="${s.perPage}"></td>
        <td class="c-url"><input type="text" data-i="${i}" data-k="url" value="${esc(s.url)}" placeholder="비우면 공통 주소 사용"></td>
      </tr>`).join('');
  }

  $('#sec-rows').addEventListener('input', (e) => {
    const el = e.target;
    const s = S.sections[+el.dataset.i];
    if (!s) return;
    const k = el.dataset.k;
    if (el.type === 'checkbox') {
      s[k] = el.checked;
      el.closest('tr').classList.toggle('off', !el.checked);
    } else if (el.type === 'number') {
      s[k] = parseInt(el.value, 10) || 0;
    } else {
      s[k] = el.value.trim();
    }
    saveSettings();
  });

  $('#src-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });

  $('#url-input').value = S.url;
  $('#url-input').addEventListener('input', (e) => {
    S.url = e.target.value.trim();
    saveSettings();
  });

  async function loadFiles(list) {
    const files = [...list];
    if (!files.length) return;
    const info = $('#file-info');
    info.className = 'file-info';
    info.textContent = '불러오는 중…';
    try {
      const pdf = files.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (pdf) {
        await Viewer.loadPdf(pdf);
        info.textContent = `${pdf.name} · 총 ${Viewer.pageCount()}쪽`;
      } else {
        const imgs = files
          .filter((f) => f.type.startsWith('image/'))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
        if (!imgs.length) throw new Error('PDF 또는 이미지 파일만 불러올 수 있습니다.');
        await Viewer.loadImages(imgs);
        info.textContent = `이미지 ${imgs.length}장 (${imgs[0].name}${imgs.length > 1 ? ` 외 ${imgs.length - 1}장` : ''})`;
      }
      info.classList.add('ok');
    } catch (err) {
      info.classList.add('err');
      info.textContent = `불러오기 실패: ${err.message || err}`;
    }
  }

  const drop = $('#drop');
  $('#file-input').addEventListener('change', (e) => loadFiles(e.target.files));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    loadFiles(e.dataTransfer.files);
  });

  $('#btn-start').addEventListener('click', async () => {
    const plan = S.sections.filter((s) => s.on).map((s) => ({
      name: s.name,
      count: clamp(s.count, 1, 100),
      time: clamp(s.time, 1, 180),
      start: Math.max(1, s.start || 1),
      perPage: clamp(s.perPage, 0, 20),
      url: normalizeUrl(s.url) || normalizeUrl(S.url),
    }));

    if (!plan.length) return alertModal('영역 선택', '<p>응시할 영역을 하나 이상 선택해 주세요.</p>');
    if (S.mode === 'file' && !Viewer.pageCount()) {
      return alertModal('문제 자료 없음', '<p>PDF 또는 이미지 파일을 먼저 불러와 주세요.</p><p>종이 문제집으로 푸는 경우 <b>[종이 책 (답안지만)]</b>을 선택하세요.</p>');
    }
    if (S.mode === 'url') {
      const missing = plan.filter((s) => !s.url).map((s) => s.name);
      if (missing.length) return alertModal('주소 없음', `<p>${missing.join(', ')} 영역의 문제 페이지 주소가 없습니다.</p><p>공통 주소나 영역별 주소를 입력해 주세요.</p>`);
    }

    S.plan = plan;
    S.answers = plan.map((s) => Array(s.count).fill(null));
    S.times = plan.map((s) => Array(s.count).fill(0));
    S.si = 0;

    document.documentElement.requestFullscreen?.().catch(() => {});
    startWait();
  });

  $('#btn-last').addEventListener('click', () => {
    const last = store.get('skct-last-result');
    if (last) showResult(last);
  });

  // ---------- ② 대기 ----------
  function startWait() {
    S.phase = 'wait';
    $('#wait-plan').innerHTML = S.plan.map((s, i) => `<span>${i + 1}. ${s.name} · ${s.count}문항 · ${s.time}분</span>`).join('');
    showScreen('wait');
    startCountdown(WAIT_SEC, [$('#wait-timer'), $('#wait-count')], () => startSample(0));
  }

  $('#btn-skip-wait').addEventListener('click', () => {
    if (S.phase === 'wait') startSample(0);
  });

  // ---------- ③ 유형 예시 ----------
  function clearTools() {
    $('#memo').value = '';
    Sketch.clear();
  }

  function renderChoices(texts) {
    const box = $('#choices');
    box.classList.toggle('with-text', !!texts);
    box.innerHTML = [1, 2, 3, 4, 5].map((n) => `
      <button type="button" class="choice" data-n="${n}" aria-pressed="false">
        <span class="cn">${n}</span>${texts ? `<span class="ct">${esc(texts[n - 1])}</span>` : ''}
      </button>`).join('');
  }

  function paintChoices(selected) {
    $$('#choices .choice').forEach((b) => {
      const on = +b.dataset.n === selected;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on);
    });
  }

  function startSample(i) {
    stopCountdown();
    closeModal(false);
    S.si = i;
    S.phase = 'sample';
    S.sampleAnswer = null;

    const sec = S.plan[i];
    const sm = SAMPLES[sec.name];
    showScreen('exam');
    $('#exam-title').textContent = `${sec.name} · 유형 예시`;
    $('#viewer').hidden = true;
    const area = $('#sample-area');
    area.hidden = false;
    area.scrollTop = 0;
    area.innerHTML = `
      <div class="sample-banner">유형 예시 문항입니다. 1분 후 본 검사가 자동으로 시작됩니다. (채점되지 않음)</div>
      <p class="sample-guide">${sm.guide}</p>
      <div class="sample-q">${sm.html}</div>
      <details class="sample-ans"><summary>정답 보기</summary><p>정답 ${CIRCLED[sm.answer]} — ${sm.explain}</p></details>`;

    $('#q-info').innerHTML = '<span class="lbl">유형</span><strong style="font-size:22px">예시</strong>';
    renderChoices(sm.choices);
    $('#btn-next').textContent = '본 검사 시작';
    clearTools();
    startCountdown(SAMPLE_SEC, [$('#exam-timer')], () => startSection(i));
  }

  // ---------- ③ 본 검사 ----------
  function startSection(i) {
    stopCountdown();
    closeModal(false);
    S.si = i;
    S.q = 0;
    S.phase = 'test';

    const sec = S.plan[i];
    $('#exam-title').textContent = sec.name;
    $('#sample-area').hidden = true;
    $('#viewer').hidden = false;

    if (S.mode === 'file') Viewer.showPages(sec.start);
    else if (S.mode === 'url') Viewer.showUrl(sec.url);

    renderChoices(null);
    showQuestion();
    startCountdown(sec.time * 60, [$('#exam-timer')], () => finishSection('timeup'), true);
  }

  function showQuestion() {
    const sec = S.plan[S.si];
    $('#q-info').innerHTML = `<span class="lbl">문항</span><strong>${S.q + 1}</strong><span class="tot">/ ${sec.count}</span>`;
    paintChoices(S.answers[S.si][S.q]);
    $('#btn-next').textContent = S.q === sec.count - 1 ? '제출' : '다음';
    clearTools();

    if (S.mode === 'file' && sec.perPage > 0) {
      Viewer.goTo(sec.start + Math.floor(S.q / sec.perPage));
    } else if (S.mode === 'none') {
      Viewer.showHtml(`
        <div class="paper">
          <div>종이 책 모드 · ${esc(sec.name)}</div>
          <div class="big">${S.q + 1}번</div>
          <div>문제집에서 해당 문항을 풀고 아래에서 답을 선택하세요.</div>
        </div>`);
    }
    S.qStart = Date.now();
  }

  function recordTime() {
    if (S.phase !== 'test') return;
    const now = Date.now();
    S.times[S.si][S.q] += (now - S.qStart) / 1000;
    S.qStart = now;
  }

  $('#choices').addEventListener('click', (e) => {
    const b = e.target.closest('.choice');
    if (!b) return;
    const n = +b.dataset.n;
    if (S.phase === 'sample') {
      S.sampleAnswer = S.sampleAnswer === n ? null : n;
      paintChoices(S.sampleAnswer);
    } else if (S.phase === 'test') {
      const a = S.answers[S.si];
      a[S.q] = a[S.q] === n ? null : n;
      paintChoices(a[S.q]);
    }
  });

  $('#btn-next').addEventListener('click', async () => {
    if (S.phase === 'sample') return startSection(S.si);
    if (S.phase !== 'test' || S.busy) return;

    const sec = S.plan[S.si];
    const isLast = S.q === sec.count - 1;
    const current = S.answers[S.si][S.q];
    S.busy = true;
    try {
      if (isLast) {
        const empty = S.answers[S.si].filter((a) => a == null).length;
        const ok = await modal({
          title: '답안 제출',
          body: `<p><b>${esc(sec.name)}</b> 영역의 마지막 문항입니다.<br>제출하면 이 영역의 답안은 더 이상 수정할 수 없습니다.</p>
                 ${empty ? `<p class="red">선택하지 않은 문항 ${empty}개는 미응답으로 처리됩니다.</p>` : ''}
                 <p>답안을 제출하시겠습니까?</p>`,
          buttons: [{ label: '취소', value: false }, { label: '제출', value: true, primary: true }],
        });
        if (ok && S.phase === 'test') finishSection('submit');
      } else {
        if (current == null) {
          const ok = await modal({
            title: '답안을 선택하지 않았습니다',
            body: `<p>다음 문항으로 넘어가면 <b>이 문항으로 다시 돌아올 수 없으며</b>, 미응답으로 처리됩니다.</p>
                   <p>답을 선택하지 않고 넘어가시겠습니까?</p>`,
            buttons: [{ label: '취소', value: false }, { label: '넘어가기', value: true, primary: true }],
          });
          if (!ok || S.phase !== 'test') return;
        }
        recordTime();
        S.q += 1;
        showQuestion();
      }
    } finally {
      S.busy = false;
    }
  });

  async function finishSection(reason) {
    recordTime();
    stopCountdown();
    S.phase = 'between';
    closeModal(false);
    $('#exam-timer').classList.remove('warn');

    if (reason === 'timeup') {
      await alertModal('시간 종료', `<p><b>${esc(S.plan[S.si].name)}</b> 영역의 제한 시간이 끝나 답안이 자동으로 제출되었습니다.</p>`);
    }
    if (S.si + 1 < S.plan.length) startSample(S.si + 1);
    else showEnd();
  }

  // ---------- 메모장 / 그림판 ----------
  $('#pad-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    $$('#pad-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    const draw = b.dataset.tab === 'draw';
    $('#memo').hidden = draw;
    $('#draw-wrap').hidden = !draw;
    if (!draw) $('#memo').focus();
  });

  $('.draw-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tool]');
    if (!b) return;
    if (b.dataset.tool === 'clear') return Sketch.clear();
    $$('.draw-tools button[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
    Sketch.setTool(b.dataset.tool);
  });

  // ---------- ④ 종료 ----------
  function showEnd() {
    S.phase = 'end';
    stopCountdown();
    const result = {
      date: new Date().toISOString(),
      sections: S.plan.map((s, i) => ({
        name: s.name,
        count: s.count,
        time: s.time,
        answers: S.answers[i],
        times: S.times[i].map((t) => Math.round(t)),
        key: '',
      })),
    };
    store.set('skct-last-result', result);
    S.result = result;

    $('#end-title').textContent = S.plan[S.plan.length - 1].name;
    showScreen('end');

    const steps = $$('#steps li');
    const bar = $('#steps');
    steps.forEach((li) => li.classList.remove('done'));
    bar.style.setProperty('--p', 0);
    steps.forEach((li, i) => setTimeout(() => {
      li.classList.add('done');
      bar.style.setProperty('--p', i / (steps.length - 1));
    }, 350 + i * 550));
  }

  $('#btn-end').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    showResult(S.result || store.get('skct-last-result'));
  });

  // ---------- ⑤ 내 답안 ----------
  const parseKey = (s) => (s.match(/[1-5]/g) || []).map(Number);

  function showResult(result) {
    if (!result) return;
    S.result = result;
    S.phase = 'setup';
    const d = new Date(result.date);
    $('#result-date').textContent = `${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 응시`;

    $('#result-list').innerHTML = result.sections.map((s, si) => {
      const answered = s.answers.filter((a) => a != null).length;
      const used = s.times.reduce((a, b) => a + b, 0);
      return `
        <section class="r-card" data-si="${si}">
          <div class="r-top">
            <h2>${esc(s.name)}</h2>
            <span class="meta">응답 ${answered} / ${s.count} · 미응답 ${s.count - answered} · 사용 시간 ${mmss(Math.min(used, s.time * 60))} / ${s.time}:00</span>
            <span class="score"></span>
          </div>
          <label class="r-key">정답 입력 <input type="text" inputmode="numeric" data-si="${si}" value="${esc(s.key || '')}" placeholder="예: 3 2 5 1 4 …  또는 32514…"></label>
          <div class="r-grid">
            ${s.answers.map((a, q) => `
              <div class="cell" data-q="${q}">
                <span class="no">${q + 1}</span>
                <span class="mark"></span>
                ${a ? `<span class="ans">${CIRCLED[a]}</span>` : '<span class="ans none">미응답</span>'}
                <span class="key"></span>
                <span class="t">${s.times[q] ? `${s.times[q]}초` : '-'}</span>
              </div>`).join('')}
          </div>
        </section>`;
    }).join('');

    result.sections.forEach((_, si) => grade(si));
    showScreen('result');
  }

  function grade(si) {
    const s = S.result.sections[si];
    const card = $(`.r-card[data-si="${si}"]`);
    const key = parseKey(s.key || '');
    let right = 0;
    $$('.cell', card).forEach((cell) => {
      const q = +cell.dataset.q;
      const k = key[q];
      const ok = k != null && s.answers[q] === k;
      if (ok) right += 1;
      cell.classList.toggle('ok', k != null && ok);
      cell.classList.toggle('ng', k != null && !ok);
      $('.mark', cell).textContent = k == null ? '' : ok ? 'O' : 'X';
      $('.key', cell).textContent = k != null && !ok ? `정답 ${CIRCLED[k]}` : '';
    });
    $('.score', card).textContent = key.length ? `정답 ${right} / ${Math.min(key.length, s.count)}` : '';
  }

  $('#result-list').addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.si == null) return;
    S.result.sections[+el.dataset.si].key = el.value;
    store.set('skct-last-result', S.result);
    grade(+el.dataset.si);
  });

  $('#btn-copy').addEventListener('click', async () => {
    const r = S.result;
    if (!r) return;
    const text = [`[SKCT 연습 답안] ${new Date(r.date).toLocaleString('ko-KR')}`]
      .concat(r.sections.map((s) => `${s.name}\n${s.answers.map((a, q) => `${q + 1}:${a ?? '-'}`).join('  ')}`))
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('답안을 복사했습니다.');
    } catch {
      toast('복사하지 못했습니다.');
    }
  });

  $('#btn-print').addEventListener('click', () => window.print());

  $('#btn-restart').addEventListener('click', () => {
    S.phase = 'setup';
    $('#btn-last').hidden = !store.get('skct-last-result');
    showScreen('setup');
  });

  // ---------- 공통 ----------
  window.addEventListener('beforeunload', (e) => {
    if (['wait', 'sample', 'test', 'between'].includes(S.phase)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  Viewer.init();
  Sketch.init($('#draw'));
  Calc.init($('#calc'));
  renderRows();
  setMode(S.mode);
  $('#btn-last').hidden = !store.get('skct-last-result');
})();
