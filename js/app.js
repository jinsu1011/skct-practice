(() => {
  'use strict';

  const { $, $$, esc, mmss, dateText, store, showScreen, modal, closeModal, alertModal, toast, downloadCsv } = UI;

  const CIRCLED = Stats.CIRCLED;
  const WAIT_SEC = 60;
  const SAMPLE_SEC = 60;
  const SECTION_NAMES = Stats.SECTIONS;

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
    resultIsLast: true, // 보고 있는 답안이 '지난 답안'(로컬 저장분)인지
    sourceName: '',
    my: null,           // 내 학습 현황 데이터
  };

  // 공용 PC에서 다른 사람의 지난 답안·미저장 기록이 섞이지 않도록 주인(owner)을 확인
  const mine = (r) => !!r && (!r.owner || !Account.user || r.owner === Account.user.id);
  const myLastResult = () => {
    const r = store.get('skct-last-result');
    return mine(r) ? r : null;
  };
  const refreshLastButton = () => { $('#btn-last').hidden = !myLastResult(); };

  const saveSettings = () => store.set('skct-settings', { mode: S.mode, url: S.url, sections: S.sections });
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
  const normalizeUrl = (u) => {
    u = (u || '').trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : `https://${u}`;
  };

  // ---------- 타이머 ----------
  let countdown = null;
  const T = { total: 0, left: 0, end: 0, els: [], onDone: null, warn: false, paused: false };

  function startCountdown(seconds, els, onDone, warn = false) {
    stopCountdown();
    Object.assign(T, { total: seconds, left: seconds, els, onDone, warn, paused: false });
    paintPause();
    runCountdown();
  }

  function runCountdown() {
    clearInterval(countdown);
    T.end = Date.now() + T.left * 1000;
    tick();
    countdown = setInterval(tick, 200);
  }

  function tick() {
    if (!T.paused) T.left = Math.max(0, (T.end - Date.now()) / 1000);
    const left = Math.ceil(T.left);
    T.els.forEach((el) => {
      el.textContent = mmss(left);
      el.classList.toggle('warn', T.warn && !T.paused && left <= 60);
      el.classList.toggle('paused', T.paused);
    });
    if (left <= 0 && !T.paused) {
      stopCountdown();
      T.onDone();
    }
  }

  function stopCountdown() {
    clearInterval(countdown);
    countdown = null;
  }

  function togglePause() {
    if (!T.onDone || !['sample', 'test'].includes(S.phase)) return;
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
  }

  function resetTimer() {
    if (!T.onDone || !['sample', 'test'].includes(S.phase)) return;
    T.left = T.total;
    if (T.paused) tick();
    else runCountdown();
  }

  function paintPause() {
    $('#btn-pause').textContent = T.paused ? '계속' : '일시정지';
    $('#btn-pause').classList.toggle('on', T.paused);
    $('#exam-timer-label').textContent = T.paused ? '일시정지' : '남은 시간';
  }

  $$('.js-home').forEach((b) => b.addEventListener('click', goHome));
  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-reset').addEventListener('click', resetTimer);

  async function goHome() {
    const ok = await modal({
      title: '처음 화면으로',
      body: '<p>시험을 중단하고 처음 화면으로 돌아가시겠습니까?</p><p class="red">지금까지 선택한 답안은 저장되지 않습니다.</p>',
      buttons: [{ label: '취소', value: false }, { label: '처음으로', value: true, primary: true }],
    });
    if (!ok) return;
    stopCountdown();
    T.onDone = null;
    T.paused = false;
    paintPause();
    S.phase = 'setup';
    setProgress(0, 0);
    $('#exam-timer').classList.remove('warn', 'paused');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    refreshLastButton();
    showScreen('setup');
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
        S.sourceName = pdf.name;
        info.textContent = `${pdf.name} · 총 ${Viewer.pageCount()}쪽`;
      } else {
        const imgs = files
          .filter((f) => f.type.startsWith('image/'))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
        if (!imgs.length) throw new Error('PDF 또는 이미지 파일만 불러올 수 있습니다.');
        await Viewer.loadImages(imgs);
        S.sourceName = `이미지 ${imgs.length}장 (${imgs[0].name})`;
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
    S.notes = plan.map(() => []);
    S.si = 0;

    document.documentElement.requestFullscreen?.().catch(() => {});
    startWait();
  });

  $('#btn-last').addEventListener('click', () => {
    const last = myLastResult();
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
    $('#choices').innerHTML = [1, 2, 3, 4, 5].map((n) => `
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

    setProgress(0, 0);
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
    setProgress(S.q + 1, sec.count);
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

  // 빨간 바 아래 가운데: '현재 문항 / 전체' 숫자와 게이지 (total 0이면 숨김)
  function setProgress(n, total) {
    $('#progress').classList.toggle('off', !total);
    $('#progress-count').textContent = `${n} / ${total}`;
    $('#progress-fill').style.width = total ? `${Math.round((n / total) * 1000) / 10}%` : '0';
  }

  function recordTime() {
    if (S.phase !== 'test' || T.paused) return;
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
        captureNote();
        recordTime();
        S.q += 1;
        showQuestion();
      }
    } finally {
      S.busy = false;
    }
  });

  // 문항을 넘기기 전에 메모장·그림판 내용을 저장 (빈 문항은 저장하지 않음)
  function captureNote() {
    if (S.phase !== 'test') return;
    const memo = $('#memo').value.trim().slice(0, 2000);
    const img = Sketch.snapshot();
    if (memo || img) S.notes[S.si][S.q] = { q: S.q, memo, img };
  }

  async function finishSection(reason) {
    captureNote();
    recordTime();
    stopCountdown();
    S.phase = 'between';
    closeModal(false);
    setProgress(S.plan[S.si].count, S.plan[S.si].count);
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
  function sourceLabel() {
    if (S.mode === 'file') return S.sourceName || 'PDF';
    if (S.mode === 'url') return [...new Set(S.plan.map((p) => p.url))].join(' ');
    return '종이 책';
  }

  function showEnd() {
    S.phase = 'end';
    stopCountdown();
    const result = {
      date: new Date().toISOString(),
      owner: Account.user?.id || null,
      source: sourceLabel(),
      sections: S.plan.map((s, i) => ({
        name: s.name,
        count: s.count,
        time: s.time,
        used: Math.min(Math.round(S.times[i].reduce((a, b) => a + b, 0)), s.time * 60),
        answers: S.answers[i],
        times: S.times[i].map((t) => Math.round(t)),
        notes: S.notes[i].filter(Boolean),
        key: '',
      })),
    };
    saveLast(result);
    S.result = result;
    S.resultIsLast = true;

    $('#end-title').textContent = S.plan[S.plan.length - 1].name;
    $('#end-note').textContent = '답안을 저장하는 중입니다…';
    showScreen('end');

    const steps = $$('#steps li');
    const bar = $('#steps');
    const done = (i) => {
      steps[i].classList.add('done');
      bar.style.setProperty('--p', i / (steps.length - 1));
    };
    steps.forEach((li) => li.classList.remove('done'));
    bar.style.setProperty('--p', 0);
    setTimeout(() => done(0), 300);

    const NOTES = {
      saved: '답안이 저장되었습니다. 종료 후 정답을 입력해 채점하면 학습 현황에 반영됩니다.',
      local: '오프라인 모드: 답안은 이 브라우저에만 저장됩니다.',
      pending: '로그인이 필요해 아직 서버에 저장하지 못했습니다. 다시 로그인하면 자동으로 저장됩니다.',
      failed: '서버에 저장하지 못했습니다. 다음 접속 때 자동으로 다시 저장합니다.',
    };
    const started = Date.now();
    saveResult(result).then((status) => {
      setTimeout(() => {
        $('#end-note').textContent = NOTES[status];
        done(1);
        setTimeout(() => done(2), 500);
      }, Math.max(0, 900 - (Date.now() - started)));
    });
  }

  // ---------- 서버 저장 (실패하면 보관했다가 다음 로그인 때 다시 저장) ----------
  const PENDING = 'skct-pending';

  async function upload(result) {
    const r = await Api.saveAttempt(
      result.sections.map(({ name, count, time, used, answers, times, notes }) => ({ name, count, time, used: used || 0, answers, times, notes: notes || [] })),
      result.source,
      result.external,
    );
    r.records.forEach((x, i) => { result.sections[i].id = x.id; });
    result.owner = Account.user.id;
    result.attemptId = r.attempt_id;
    await Promise.all(result.sections.filter((x) => x.key).map((x) => Api.grade(x.id, x.key)));
    const last = store.get('skct-last-result');
    if (last && last.date === result.date) saveLast(result);
  }

  // 메모·그림까지 넣으면 브라우저 저장 용량을 넘을 수 있어, 실패하면 그림을 빼고 저장
  const slim = (r) => ({ ...r, sections: r.sections.map((s) => ({ ...s, notes: (s.notes || []).filter((n) => n.memo).map((n) => ({ ...n, img: null })) })) });
  const saveLast = (r) => store.set('skct-last-result', r) || store.set('skct-last-result', slim(r));
  const savePending = (list) => store.set(PENDING, list) || store.set(PENDING, list.map(slim));

  function addPending(result) {
    const list = store.get(PENDING) || [];
    if (!list.some((r) => r.date === result.date)) list.push(result);
    savePending(list);
  }

  function updatePending(result) {
    const list = store.get(PENDING) || [];
    const i = list.findIndex((r) => r.date === result.date);
    if (i >= 0) {
      list[i] = result;
      savePending(list);
    }
  }

  async function saveResult(result) {
    if (!Api.enabled) return 'local';
    if (!Account.online) {
      addPending(result);
      return 'pending';
    }
    try {
      await upload(result);
      return 'saved';
    } catch (err) {
      addPending(result);
      return err.expired ? 'pending' : 'failed';
    }
  }

  async function flushPending() {
    const list = store.get(PENDING) || [];
    if (!list.length || !Account.online) return;
    const left = [];
    for (const r of list) {
      if (!mine(r)) { left.push(r); continue; }
      try { await upload(r); } catch { left.push(r); }
    }
    savePending(left);
    if (list.length > left.length) toast(`저장되지 않았던 응시 기록 ${list.length - left.length}개를 저장했습니다.`);
  }

  $('#btn-end').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    showResult(S.result || myLastResult());
  });

  // ---------- ⑤ 내 답안 ----------
  const parseKey = (s) => (s.match(/[1-5]/g) || []).map(Number);

  function showResult(result, { isLast = true, readonly = false, back = null, who = '' } = {}) {
    if (!result) return;
    S.result = result;
    S.resultIsLast = isLast;
    S.resultBack = back;
    S.phase = 'setup';
    $$('.js-online').forEach((el) => { el.hidden = !Account.online || readonly; });
    $('#btn-restart').hidden = readonly;
    $('#btn-result-back').hidden = !back;
    $('#result-title').textContent = who ? `${who} 학생 답안` : '내 답안';
    $('#result-who').textContent = who ? `${who} 학생 답안` : '작성한 답안';
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
          <label class="r-key">정답 입력 <input type="text" inputmode="numeric" data-si="${si}" value="${esc(s.key || '')}" placeholder="예: 3 2 5 1 4 …  또는 32514…" ${readonly ? 'disabled' : ''}></label>
          <div class="r-grid">
            ${s.answers.map((a, q) => `
              <div class="cell" data-q="${q}">
                <span class="no">${q + 1}</span>
                <span class="mark"></span>
                ${a ? `<span class="ans">${CIRCLED[a]}</span>` : '<span class="ans none">미응답</span>'}
                <span class="key"></span>
                <span class="t">${s.times[q] ? `${s.times[q]}초` : '-'}</span>
                <span class="memo-ic" title="메모·그림 보기">✎</span>
              </div>`).join('')}
          </div>
        </section>`;
    }).join('');

    result.sections.forEach((_, si) => grade(si));
    S.resultNotes = result.sections.map((s) => noteMap(s.notes));
    paintNotes();
    showScreen('result');
    loadNotes(result);
  }

  const noteMap = (notes) => Object.fromEntries((notes || []).map((n) => [n.q, n]));

  function paintNotes() {
    $$('.r-card').forEach((card) => {
      const notes = S.resultNotes[+card.dataset.si] || {};
      $$('.cell', card).forEach((cell) => cell.classList.toggle('has-note', !!notes[+cell.dataset.q]));
    });
  }

  // 서버에 저장된 응시라면 메모·그림을 따로 불러온다 (목록에는 용량 때문에 빠져 있음)
  async function loadNotes(result) {
    if (!result.attemptId || !Account.online || result.sections.every((s) => s.notes)) return;
    try {
      const rows = await Api.attemptNotes(result.attemptId);
      if (S.result !== result) return;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.notes]));
      result.sections.forEach((s, si) => {
        if (!s.notes && byId[s.id]) S.resultNotes[si] = noteMap(byId[s.id]);
      });
      paintNotes();
    } catch {
      /* 메모를 못 불러와도 답안 보기에는 지장 없음 */
    }
  }

  $('#result-list').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell.has-note');
    if (!cell) return;
    const si = +cell.closest('.r-card').dataset.si;
    const q = +cell.dataset.q;
    const n = S.resultNotes[si]?.[q];
    if (!n) return;
    const img = typeof n.img === 'string' && n.img.startsWith('data:image/') ? n.img : '';
    alertModal(`${S.result.sections[si].name} ${q + 1}번 메모·그림`, `
      ${n.memo ? `<pre class="note-memo">${esc(n.memo)}</pre>` : ''}
      ${img ? `<img class="note-img" src="${esc(img)}" alt="그림판">` : ''}`);
  });

  $('#btn-result-back').addEventListener('click', () => {
    if (S.resultBack) showScreen(S.resultBack);
  });

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

  const gradeTimers = {};

  $('#result-list').addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.si == null) return;
    const si = +el.dataset.si;
    const sec = S.result.sections[si];
    sec.key = el.value;
    if (S.resultIsLast) saveLast(S.result);
    updatePending(S.result);
    grade(si);

    // 입력이 멈추면 서버에 채점 결과 저장
    if (!sec.id || !Account.online) return;
    clearTimeout(gradeTimers[sec.id]);
    gradeTimers[sec.id] = setTimeout(async () => {
      try {
        await Api.grade(sec.id, sec.key);
        toast('채점 결과를 저장했습니다.');
      } catch (err) {
        if (!Account.handleError(err)) toast(err.message);
      }
    }, 800);
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

  function goSetup() {
    S.phase = 'setup';
    refreshLastButton();
    showScreen('setup');
  }

  $('#btn-restart').addEventListener('click', goSetup);

  // ---------- 내 학습 현황 ----------
  async function openStats() {
    if (!Account.online) return;
    const u = Account.user;
    showScreen('stats');
    $('#stats-title').textContent = `${u.name}님의 학습 현황`;
    const via = u.provider === 'slack' ? `Slack 로그인${u.email ? ` (${u.email})` : ''}` : `아이디 ${u.username}`;
    $('#stats-sub').textContent = u.is_admin ? '관리자 계정' : `${u.campus} ${u.class_no}반 · ${via}`;
    $('#btn-change-pw').hidden = u.provider === 'slack';
    $('#stats-body').innerHTML = '<p class="empty">불러오는 중…</p>';
    try {
      S.my = await Api.myData();
      Stats.renderDashboard($('#stats-body'), S.my);
    } catch (err) {
      if (!Account.handleError(err)) $('#stats-body').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  function attemptToResult(recs) {
    return {
      date: recs[0].created_at,
      attemptId: recs[0].attempt_id,
      source: recs[0].source,
      sections: recs.map((r) => ({
        id: r.id, name: r.section, count: r.q_count, time: r.time_limit, used: r.used_sec,
        answers: r.answers, times: r.times, key: r.answer_key || '',
      })),
    };
  }

  $('#stats-body').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || !S.my) return;
    const recs = S.my.records.filter((r) => r.attempt_id === b.dataset.attempt);
    if (!recs.length) return;
    if (b.dataset.act === 'open') {
      showResult(attemptToResult(recs), { isLast: false, back: 'stats' });
      return;
    }
    const ok = await modal({
      title: '응시 기록 삭제',
      body: `<p>${dateText(recs[0].created_at, true)} 응시 기록(${recs.map((r) => esc(r.section)).join(', ')})을 삭제하시겠습니까?</p><p class="red">삭제하면 되돌릴 수 없습니다.</p>`,
      buttons: [{ label: '취소', value: false }, { label: '삭제', value: true, primary: true }],
    });
    if (!ok) return;
    try {
      await Api.deleteAttempt(b.dataset.attempt);
      toast('삭제했습니다.');
      openStats();
    } catch (err) {
      if (!Account.handleError(err)) toast(err.message);
    }
  });

  $('#admin-user-body').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act="open"]');
    const data = Admin.detail;
    if (!b || !data) return;
    const recs = data.records.filter((r) => r.attempt_id === b.dataset.attempt);
    if (recs.length) showResult(attemptToResult(recs), { isLast: false, readonly: true, back: 'admin-user', who: data.user.name });
  });

  $('#btn-stats-csv').addEventListener('click', () => {
    if (!S.my) return;
    downloadCsv(`SKCT_내기록_${dateText(new Date().toISOString()).replace(/\./g, '')}.csv`,
      [Stats.recordCsvHeader, ...S.my.records.map(Stats.recordCsvRow)]);
  });

  $('#btn-change-pw').addEventListener('click', async () => {
    const pw = await modal({
      title: '비밀번호 변경',
      body: `<label class="field">현재 비밀번호<input type="password" id="pw-old" class="text-input" autocomplete="current-password"></label>
             <label class="field">새 비밀번호 (6자 이상)<input type="password" id="pw-new" class="text-input" autocomplete="new-password"></label>`,
      buttons: [{ label: '취소', value: null }, { label: '변경', value: () => [$('#pw-old').value, $('#pw-new').value], primary: true }],
    });
    if (!pw) return;
    try {
      await Api.changePassword(pw[0], pw[1]);
      toast('비밀번호를 변경했습니다.');
    } catch (err) {
      if (!Account.handleError(err)) alertModal('변경 실패', `<p>${esc(err.message)}</p>`);
    }
  });

  // 상단 메뉴 등 data-go 버튼
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const to = b.dataset.go;
    if (to === 'setup') goSetup();
    else if (to === 'stats') openStats();
    else if (to === 'admin') Admin.open();
  });

  // ---------- 시험모드 북마크에서 넘어온 기록 ----------
  function parseImport(r) {
    const sections = (r?.sections || []).filter((x) => SECTION_NAMES.includes(x.name)
      && Number.isInteger(x.count) && x.count >= 1 && x.count <= 100
      && Array.isArray(x.answers) && x.answers.length === x.count
      && Array.isArray(x.times) && x.times.length === x.count)
      .map((x) => ({
        name: x.name,
        count: x.count,
        time: clamp(Number(x.time), 1, 180),
        used: clamp(Number(x.used) || 0, 0, 180 * 60),
        answers: x.answers.map((a) => ([1, 2, 3, 4, 5].includes(a) ? a : null)),
        times: x.times.map((t) => Math.max(0, Math.round(Number(t) || 0))),
        notes: (Array.isArray(x.notes) ? x.notes : [])
          .filter((n) => Number.isInteger(n?.q) && n.q >= 0 && n.q < x.count)
          .map((n) => ({
            q: n.q,
            memo: String(n.memo || '').slice(0, 2000),
            img: typeof n.img === 'string' && n.img.startsWith('data:image/') && n.img.length <= 60000 ? n.img : null,
          }))
          .filter((n) => n.memo || n.img),
        key: '',
      }));
    if (!sections.length) return null;
    return {
      date: typeof r.date === 'string' ? r.date : new Date().toISOString(),
      source: String(r.source || '').slice(0, 300),
      external: true,
      msg: !!r.msg,   // 그림은 시험모드 창에 남아 있어 메시지로 받아와야 함
      sections,
    };
  }

  // #import=... (작은 기록) 방식
  function readImport() {
    const m = location.hash.match(/^#import=(.+)$/);
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);
    let r = null;
    try { r = parseImport(JSON.parse(decodeURIComponent(m[1]))); } catch { /* 아래에서 안내 */ }
    if (!r) toast('가져온 기록을 읽지 못했습니다.');
    return r;
  }

  // 주소에는 답안·메모만 담겨 온다. 그림은 시험모드 창(opener)에 요청해서 받고, 못 받으면 그림 없이 진행
  function completeImport(r) {
    if (!r.msg || !window.opener) {
      keepImport(r);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (full) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        keepImport(full || r);
        resolve();
      };
      const onMsg = (e) => {
        if (e.source !== window.opener || e.data?.type !== 'skct-import') return;
        const full = parseImport(e.data.result);
        finish(full && full.date === r.date ? full : null);
      };
      window.addEventListener('message', onMsg);
      window.opener.postMessage({ type: 'skct-import-ready' }, '*');
      setTimeout(() => finish(null), 3000);
    });
  }

  async function receiveImport(result) {
    const status = await saveResult(result);
    saveLast(result);
    showResult(result);
    toast(status === 'saved' ? '시험모드 기록을 저장했습니다. 정답을 입력해 채점하세요.'
      : status === 'local' ? '시험모드 기록을 불러왔습니다.'
        : '기록을 아직 서버에 저장하지 못했습니다. 다음 접속 때 다시 저장합니다.');
  }

  // ---------- 공통 ----------
  window.addEventListener('beforeunload', (e) => {
    if (['wait', 'sample', 'test', 'between'].includes(S.phase)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- 시험모드 북마크 버튼 ----------
  const BASE = new URL('.', location.href).href;
  const bm = $('#bm-link');
  bm.href = `javascript:(()=>{var s=document.createElement('script');s.src='${BASE}overlay.js?v='+Date.now();document.body.appendChild(s);})();`;
  bm.addEventListener('click', (e) => {
    e.preventDefault();
    alertModal('즐겨찾기 바로 끌어다 놓으세요', '<p>이 버튼은 여기서 누르는 버튼이 아닙니다.</p><p>마우스로 잡아서 <b>즐겨찾기 바에 끌어다 놓은 뒤</b>, 링커리어 문제 페이지에서 눌러 주세요.</p>');
  });

  // ---------- 시작 ----------
  // 가져온 기록은 로그인(특히 Slack으로 페이지를 떠났다 오는 경우) 뒤에 처리하도록 잠시 보관
  const IMPORT_KEY = 'skct-import';
  const keepImport = (r) => { try { sessionStorage.setItem(IMPORT_KEY, JSON.stringify(r)); } catch { /* 저장 불가 */ } };
  const takeImport = () => {
    try {
      const r = JSON.parse(sessionStorage.getItem(IMPORT_KEY));
      sessionStorage.removeItem(IMPORT_KEY);
      return r;
    } catch {
      return null;
    }
  };
  const firstImport = readImport();
  const importReady = firstImport ? completeImport(firstImport) : Promise.resolve();
  Viewer.init();
  Sketch.init($('#draw'));
  Calc.init($('#calc'));
  Admin.init();
  renderRows();
  setMode(S.mode);
  refreshLastButton();

  Account.init(async () => {
    refreshLastButton();
    await flushPending();
    await importReady;
    const r = takeImport();
    if (r) receiveImport(r);
  });

  // 이미 열려 있는 탭으로 기록이 넘어온 경우
  window.addEventListener('hashchange', async () => {
    const r = readImport();
    if (!r) return;
    await completeImport(r);
    if (Account.online || !Api.enabled) {
      const x = takeImport();
      if (x) receiveImport(x);
    }
  });
})();
