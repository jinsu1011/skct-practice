// 학습 현황 분석: 응시 기록(records)과 접속 기록(visits)으로 통계·차트·분석 문구를 만든다.
window.Stats = (() => {
  const { esc, pct, duration, dateText } = UI;
  const SECTIONS = ['언어이해', '자료해석', '창의수리', '언어추리', '수열추리'];
  const CIRCLED = ['', '①', '②', '③', '④', '⑤'];

  const keyOf = (r) => (r.answer_key || '').split('').map(Number);
  const answeredCount = (r) => r.answers.filter((a) => a != null).length;
  const seoulDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

  function compute(records, visits = []) {
    const st = {
      attempts: new Set(records.map((r) => r.attempt_id)).size,
      records: records.length,
      qTotal: 0, answered: 0, studySec: 0, graded: 0, correct: 0, ungraded: 0,
      visitSec: visits.reduce((a, v) => a + v.seconds, 0),
      bySection: {},
      position: {},
      trendMap: {},
    };
    SECTIONS.forEach((s) => {
      st.bySection[s] = {
        name: s, records: 0, qTotal: 0, answered: 0, graded: 0, correct: 0, studySec: 0,
        timeSum: 0, timeN: 0, allowed: 0, early: { graded: 0, wrong: 0 }, late: { graded: 0, wrong: 0 },
      };
    });

    records.forEach((r) => {
      const b = st.bySection[r.section];
      if (!b) return;
      const key = keyOf(r);
      b.records += 1;
      b.qTotal += r.q_count;
      b.studySec += r.used_sec;
      b.allowed += r.time_limit * 60;
      st.qTotal += r.q_count;
      st.studySec += r.used_sec;

      let rc = 0;
      r.answers.forEach((a, i) => {
        if (a != null) {
          b.answered += 1;
          st.answered += 1;
          if (r.times[i] > 0) { b.timeSum += r.times[i]; b.timeN += 1; }
        }
        const k = key[i];
        if (!k) return;
        const ok = a === k;
        b.graded += 1;
        st.graded += 1;
        if (ok) { b.correct += 1; st.correct += 1; rc += 1; }
        const pos = (st.position[r.section] ||= []);
        pos[i] ||= { graded: 0, wrong: 0, blank: 0 };
        pos[i].graded += 1;
        if (!ok) pos[i].wrong += 1;
        if (a == null) pos[i].blank += 1;
        const part = i >= Math.ceil(r.q_count * 0.75) ? b.late : b.early;
        part.graded += 1;
        if (!ok) part.wrong += 1;
      });

      if (key.length) {
        const day = seoulDay(new Date(r.created_at));
        const t = (st.trendMap[day] ||= { day, correct: 0, graded: 0, sections: new Set() });
        t.correct += rc;
        t.graded += key.length;
        t.sections.add(r.section);
      } else {
        st.ungraded += 1;
      }
    });

    Object.values(st.bySection).forEach((b) => {
      b.acc = b.graded ? b.correct / b.graded : null;
      b.avgTime = b.timeN ? b.timeSum / b.timeN : null;
      b.allowedPerQ = b.qTotal ? b.allowed / b.qTotal : null;
      b.blankRate = b.qTotal ? (b.qTotal - b.answered) / b.qTotal : null;
    });
    st.acc = st.graded ? st.correct / st.graded : null;
    st.trend = Object.values(st.trendMap)
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((t) => ({ ...t, acc: t.correct / t.graded, sections: [...t.sections] }));

    const ranked = Object.values(st.bySection).filter((b) => b.graded >= 5).sort((a, b) => a.acc - b.acc);
    // 채점한 영역이 2개 이상이고 정답률 차이가 있을 때만 취약/강점 영역을 정한다
    const spread = ranked.length >= 2 && ranked[0].acc < ranked[ranked.length - 1].acc;
    st.weak = spread ? ranked[0] : null;
    st.strong = spread ? ranked[ranked.length - 1] : null;
    st.insights = insights(st, ranked);
    return st;
  }

  function insights(st, ranked) {
    const out = [];
    if (!st.records) {
      out.push({ tone: 'info', text: '아직 응시 기록이 없어요. 시험을 한 번 응시해 보세요.' });
      return out;
    }
    if (st.weak) out.push({ tone: 'warn', text: `<b>${esc(st.weak.name)}</b> 정답률이 <b>${pct(st.weak.acc)}</b>로 가장 낮아요. 이 영역을 먼저 보강해 보세요.` });
    if (st.strong && st.strong !== st.weak) out.push({ tone: 'good', text: `가장 강한 영역은 <b>${esc(st.strong.name)}</b>(정답률 ${pct(st.strong.acc)})이에요.` });

    // 영역마다 문제점을 한 줄로 묶고, 정답률이 낮은 영역부터 최대 3개만 보여준다
    const issues = Object.values(st.bySection).map((b) => {
      const list = [];
      if (b.qTotal >= 10 && b.blankRate >= 0.15) list.push(`미응답 ${pct(b.blankRate)}`);
      const lateRate = b.late.graded ? b.late.wrong / b.late.graded : null;
      const earlyRate = b.early.graded ? b.early.wrong / b.early.graded : null;
      if (b.late.graded >= 4 && earlyRate != null && lateRate - earlyRate >= 0.15) list.push(`후반부 오답률 ${pct(lateRate)} (앞부분 ${pct(earlyRate)})`);
      if (b.timeN >= 10 && b.avgTime > b.allowedPerQ) list.push(`문항당 평균 ${Math.round(b.avgTime)}초 (기준 ${Math.round(b.allowedPerQ)}초)`);
      return { b, list };
    }).filter((x) => x.list.length)
      .sort((x, y) => (x.b.acc ?? 1) - (y.b.acc ?? 1))
      .slice(0, 3);
    issues.forEach(({ b, list }) => {
      out.push({ tone: 'warn', text: `<b>${esc(b.name)}</b> 시간 배분 점검: ${list.join(' · ')}. 제한 시간 안에 끝까지 푸는 연습이 필요해요.` });
    });

    if (!ranked.length && st.graded === 0) {
      out.push({ tone: 'info', text: '채점한 기록이 없어요. 응시 기록에서 정답을 입력하면 영역별 분석이 표시돼요.' });
    } else if (st.ungraded) {
      out.push({ tone: 'info', text: `채점하지 않은 기록이 ${st.ungraded}개 있어요. 정답을 입력하면 분석이 더 정확해져요.` });
    }
    if (out.length === 0) out.push({ tone: 'good', text: '눈에 띄는 약점이 없어요. 지금처럼 꾸준히 연습해 보세요.' });
    return out;
  }

  // ---------- 화면 조각 ----------
  const tile = (label, value, sub) => `
    <div class="tile"><span class="tile-label">${label}</span><strong class="tile-value">${value}</strong><span class="tile-sub">${sub}</span></div>`;

  function sectionBars(st) {
    return `<div class="hbars">${SECTIONS.map((s) => {
      const b = st.bySection[s];
      const w = b.acc == null ? 0 : Math.max(b.acc * 100, 1.5);
      const tipText = `<b>${s}</b><br>정답 ${b.correct} / 채점 ${b.graded}<br>응답 ${b.answered} / ${b.qTotal}문항<br>평균 ${b.avgTime ? Math.round(b.avgTime) : '-'}초/문항 · 미응답 ${pct(b.blankRate)}`;
      return `
        <div class="hbar" data-tip="${esc(tipText)}">
          <span class="hbar-name">${s}${st.weak === b ? ' <em class="tag-weak">취약</em>' : ''}</span>
          <span class="hbar-track"><span class="hbar-fill" style="width:${w}%"></span></span>
          <span class="hbar-val">${b.acc == null ? '<span class="muted">채점 없음</span>' : pct(b.acc)}</span>
          <span class="hbar-sub">${b.records ? `${b.records}회 · 평균 ${b.avgTime ? Math.round(b.avgTime) : '-'}초/문항` : '응시 기록 없음'}</span>
        </div>`;
    }).join('')}</div>`;
  }

  function trendChart(trend) {
    if (trend.length < 2) return '<p class="empty">이틀 이상 채점한 기록이 쌓이면 날짜별 정답률 추이가 표시돼요.</p>';
    const pts = trend.slice(-30);
    const W = 600, H = 220, L = 40, R = 12, T = 12, B = 28;
    const x = (i) => L + (pts.length === 1 ? 0 : (i * (W - L - R)) / (pts.length - 1));
    const y = (v) => T + (1 - v) * (H - T - B);
    const grid = [0, 0.5, 1].map((v) => `
      <line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v * 100}%</text>`).join('');
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.acc).toFixed(1)}`).join(' ');
    const dots = pts.map((p, i) => `
      <g class="pt" data-tip="${esc(`<b>${p.day}</b><br>정답률 ${pct(p.acc)} (${p.correct}/${p.graded})<br>${p.sections.join(', ')}`)}">
        <rect x="${x(i) - 10}" y="${T}" width="20" height="${H - T - B}" fill="transparent"/>
        <circle cx="${x(i)}" cy="${y(p.acc)}" r="4"/>
      </g>`).join('');
    const first = `<text x="${L}" y="${H - 8}" class="axis">${pts[0].day}</text>`;
    const last = `<text x="${W - R}" y="${H - 8}" class="axis" text-anchor="end">${pts[pts.length - 1].day}</text>`;
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="채점한 기록의 정답률 추이">
      ${grid}<path d="${path}" class="line"/>${dots}${first}${last}</svg>
      <p class="hint">점 하나가 하루 동안 채점한 문항 전체의 정답률입니다 (최근 30일).</p>`;
  }

  // 오답률 0 → 연한 색, 1 → 진한 빨강 (한 가지 색의 명도 단계)
  function heatColor(v) {
    const a = [253, 236, 238];
    const b = [179, 0, 32];
    const c = a.map((x, i) => Math.round(x + (b[i] - x) * v));
    return `rgb(${c.join(',')})`;
  }

  function heatmap(st) {
    const rows = SECTIONS.filter((s) => st.position[s]?.length);
    if (!rows.length) return '<p class="empty">채점한 기록이 있으면 문항 번호별로 어디서 많이 틀렸는지 표시돼요.</p>';
    const maxQ = Math.max(...rows.map((s) => st.position[s].length));
    const head = `<div class="hm-row hm-head"><span class="hm-name"></span>${Array.from({ length: maxQ }, (_, i) => `<span class="hm-col">${i + 1}</span>`).join('')}</div>`;
    const body = rows.map((s) => `
      <div class="hm-row"><span class="hm-name">${s}</span>${Array.from({ length: maxQ }, (_, i) => {
        const p = st.position[s][i];
        if (!p) return '<span class="hm-cell none" data-tip="채점 기록 없음"></span>';
        const rate = p.wrong / p.graded;
        return `<span class="hm-cell" style="background:${heatColor(rate)}" data-tip="${esc(`<b>${s} ${i + 1}번</b><br>오답 ${p.wrong} / ${p.graded} (${pct(rate)})${p.blank ? `<br>미응답 ${p.blank}` : ''}`)}"></span>`;
      }).join('')}</div>`).join('');
    const legend = `<div class="hm-legend"><span>오답률 낮음</span><span class="hm-grad"></span><span>높음</span><span class="hm-cell none"></span><span>채점 없음</span></div>`;
    return `<div class="heatmap">${head}${body}</div>${legend}`;
  }

  function visitBars(visits) {
    const byDay = Object.fromEntries(visits.map((v) => [v.day, v.seconds]));
    const days = Array.from({ length: 14 }, (_, i) => seoulDay(new Date(Date.now() - (13 - i) * 86400000)));
    const max = Math.max(60, ...days.map((d) => byDay[d] || 0));
    return `<div class="vbars">${days.map((d) => {
      const s = byDay[d] || 0;
      const label = `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
      return `<div class="vbar" data-tip="<b>${label}</b><br>${s ? duration(s) : '접속 없음'}">
        <span class="vbar-track"><span class="vbar-fill" style="height:${s ? Math.max((s / max) * 100, 3) : 0}%"></span></span>
        <span class="vbar-label">${label}</span></div>`;
    }).join('')}</div>`;
  }

  function recordTable(records, opts) {
    if (!records.length) return '<p class="empty">아직 응시 기록이 없어요.</p>';
    const rows = [...records].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>응시 일시</th><th>영역</th><th>응답</th><th>채점</th><th>사용 시간</th><th>자료</th>${opts.readonly ? '' : '<th></th>'}</tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>${dateText(r.created_at, true)}</td>
          <td>${esc(r.section)}</td>
          <td>${answeredCount(r)} / ${r.q_count}</td>
          <td>${r.graded ? `<b>${r.correct}</b> / ${r.graded} (${pct(r.correct / r.graded)})` : '<span class="muted">미채점</span>'}</td>
          <td>${duration(r.used_sec)} / ${r.time_limit}분</td>
          <td class="src" title="${esc(r.source || '')}">${esc(r.source || '-')}</td>
          ${opts.readonly ? '' : `<td class="acts">
            <button type="button" class="btn sm" data-act="open" data-attempt="${r.attempt_id}">${r.graded ? '답안 보기' : '채점하기'}</button>
            <button type="button" class="btn sm ghost" data-act="delete" data-attempt="${r.attempt_id}">삭제</button></td>`}
        </tr>`).join('')}</tbody></table></div>`;
  }

  function renderDashboard(el, data, opts = {}) {
    const st = compute(data.records, data.visits);
    el.innerHTML = `
      <div class="tiles">
        ${tile('응시 횟수', `${st.attempts}회`, `영역 기록 ${st.records}개`)}
        ${tile('푼 문항', `${st.answered.toLocaleString()}`, `전체 ${st.qTotal.toLocaleString()}문항 중 응답`)}
        ${tile('정답률', pct(st.acc), `채점한 ${st.graded.toLocaleString()}문항 기준`)}
        ${tile('학습 시간', duration(st.studySec), '시험에 쓴 시간')}
        ${tile('접속 시간', duration(st.visitSec), '사이트를 보고 있던 시간')}
      </div>
      <section class="dash-card">
        <h3>학습 분석</h3>
        <ul class="insights">${st.insights.map((i) => `<li class="${i.tone}"><span class="ico">${i.tone === 'warn' ? '!' : i.tone === 'good' ? '✓' : 'i'}</span><span>${i.text}</span></li>`).join('')}</ul>
      </section>
      <div class="dash-grid">
        <section class="dash-card"><h3>영역별 정답률</h3>${sectionBars(st)}</section>
        <section class="dash-card"><h3>정답률 추이</h3>${trendChart(st.trend)}</section>
      </div>
      <section class="dash-card">
        <h3>문항 번호별 오답률</h3>
        <p class="hint">칸이 진할수록 그 번호에서 많이 틀렸다는 뜻입니다. 뒷번호가 진하면 시간 배분을, 특정 번호대만 진하면 해당 유형을 점검해 보세요.</p>
        ${heatmap(st)}
      </section>
      <section class="dash-card"><h3>최근 14일 접속 시간</h3>${visitBars(data.visits)}</section>
      <section class="dash-card"><h3>응시 기록</h3>${recordTable(data.records, opts)}</section>`;
    return st;
  }

  // ---------- CSV 행 ----------
  const recordCsvHeader = ['응시일시', '영역', '문항수', '제한시간(분)', '사용시간(초)', '응답수', '채점수', '정답수', '정답률', '내 답안', '정답', '자료'];
  const recordCsvRow = (r) => [
    dateText(r.created_at, true), r.section, r.q_count, r.time_limit, r.used_sec, answeredCount(r),
    r.graded, r.graded ? r.correct : '', r.graded ? (r.correct / r.graded).toFixed(3) : '',
    r.answers.map((a) => a ?? '-').join(' '), r.answer_key || '', r.source || '',
  ];

  return { SECTIONS, CIRCLED, compute, renderDashboard, answeredCount, recordCsvHeader, recordCsvRow };
})();
