// 관리자: 학생 현황 · 반별 요약 · 접속 기록 · CSV 내보내기 · 학생 상세
window.Admin = (() => {
  const { $, esc, pct, duration, dateText, showScreen, modal, toast, downloadCsv } = UI;
  const { SECTIONS } = Stats;

  const A = { users: [], records: [], logs: [], rows: [], tab: 'students', sort: { key: 'campus', dir: 1 }, detailUser: null };

  async function open() {
    showScreen('admin');
    $('#admin-body').innerHTML = '<p class="empty">불러오는 중…</p>';
    try {
      const [users, records, logs] = await Promise.all([Api.adminUsers(), Api.adminRecords(), Api.adminLogs(500)]);
      A.users = users.filter((u) => !u.is_admin);
      A.records = records;
      A.logs = logs;
      A.rows = A.users.map(buildRow);
      $('#admin-sub').textContent = `학생 ${A.users.length}명 · 영역 기록 ${records.length.toLocaleString()}개 · ${dateText(new Date().toISOString(), true)} 기준`;
      render();
    } catch (err) {
      if (!Account.handleError(err)) $('#admin-body').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  function buildRow(u) {
    const recs = A.records.filter((r) => r.user_id === u.id);
    const st = Stats.compute(recs);
    return {
      u, recs, st,
      campus: u.campus || '', class_no: u.class_no || 0, name: u.name, username: u.username,
      last_seen: u.last_seen || '', visit_sec: u.visit_sec, login_count: u.login_count,
      attempts: st.attempts, answered: st.answered, study_sec: st.studySec,
      acc: st.acc ?? -1, graded: st.graded, weak: st.weak?.name || '',
    };
  }

  function filtered() {
    const campus = $('#f-campus').value;
    const cls = $('#f-class').value;
    const q = $('#f-q').value.trim().toLowerCase();
    return A.rows.filter((r) => (!campus || r.campus === campus)
      && (!cls || String(r.class_no) === cls)
      && (!q || r.name.toLowerCase().includes(q) || r.username.includes(q)));
  }

  function sorted(rows) {
    const { key, dir } = A.sort;
    return [...rows].sort((a, b) => {
      let x = a[key];
      let y = b[key];
      if (key === 'campus') { x = `${a.campus}${String(a.class_no).padStart(2, '0')}${a.name}`; y = `${b.campus}${String(b.class_no).padStart(2, '0')}${b.name}`; }
      if (x < y) return -dir;
      if (x > y) return dir;
      return 0;
    });
  }

  const COLS = [
    ['campus', '캠퍼스·반'], ['name', '이름'], ['username', '아이디'], ['last_seen', '최근 접속'],
    ['visit_sec', '접속 시간'], ['login_count', '로그인'], ['attempts', '응시'], ['answered', '푼 문항'],
    ['study_sec', '학습 시간'], ['acc', '정답률'], ['weak', '취약 영역'],
  ];

  function studentsTable(rows) {
    if (!rows.length) return '<p class="empty">조건에 맞는 학생이 없습니다.</p>';
    const arrow = (k) => (A.sort.key === k ? (A.sort.dir > 0 ? ' ▲' : ' ▼') : '');
    return `<div class="table-wrap"><table class="data-table click">
      <thead><tr>${COLS.map(([k, label]) => `<th data-sort="${k}">${label}${arrow(k)}</th>`).join('')}</tr></thead>
      <tbody>${sorted(rows).map((r) => `
        <tr data-user="${r.u.id}">
          <td>${esc(r.campus)} ${r.class_no}반</td>
          <td><b>${esc(r.name)}</b></td>
          <td class="muted">${esc(r.username)}</td>
          <td>${r.last_seen ? dateText(r.last_seen, true) : '-'}</td>
          <td>${duration(r.visit_sec)}</td>
          <td>${r.login_count}회</td>
          <td>${r.attempts}회</td>
          <td>${r.answered.toLocaleString()}</td>
          <td>${duration(r.study_sec)}</td>
          <td>${r.acc < 0 ? '<span class="muted">-</span>' : `<b>${pct(r.acc)}</b> <span class="muted">(${r.graded})</span>`}</td>
          <td>${r.weak ? `<span class="tag-weak">${esc(r.weak)}</span>` : '-'}</td>
        </tr>`).join('')}</tbody></table></div>
      <p class="hint">행을 누르면 학생별 상세 학습 현황을 볼 수 있습니다. 정답률은 학생이 직접 채점한 문항 기준입니다.</p>`;
  }

  function classSummary(rows) {
    const groups = {};
    rows.forEach((r) => {
      const k = `${r.campus} ${r.class_no}반`;
      (groups[k] ||= []).push(r);
    });
    const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    if (!keys.length) return '<p class="empty">조건에 맞는 학생이 없습니다.</p>';
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>반</th><th>학생</th><th>응시 학생</th><th>푼 문항</th><th>평균 학습 시간</th><th>평균 접속 시간</th><th>전체 정답률</th>${SECTIONS.map((s) => `<th>${s}</th>`).join('')}</tr></thead>
      <tbody>${keys.map((k) => {
        const g = groups[k];
        const st = Stats.compute(g.flatMap((r) => r.recs));
        const active = g.filter((r) => r.attempts > 0).length;
        const avg = (f) => g.reduce((a, r) => a + r[f], 0) / g.length;
        return `<tr>
          <td><b>${esc(k)}</b></td><td>${g.length}명</td><td>${active}명</td>
          <td>${st.answered.toLocaleString()}</td><td>${duration(avg('study_sec'))}</td><td>${duration(avg('visit_sec'))}</td>
          <td><b>${pct(st.acc)}</b></td>
          ${SECTIONS.map((s) => `<td>${pct(st.bySection[s].acc)}</td>`).join('')}
        </tr>`;
      }).join('')}</tbody></table></div>
      <p class="hint">정답률은 반 학생들이 채점한 문항을 모두 합쳐 계산합니다.</p>`;
  }

  const KIND = { signup: '회원가입', login: '로그인', logout: '로그아웃', fail: '로그인 실패' };

  function shortUa(ua) {
    if (!ua) return '-';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : '기타';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
    return `${os} ${br}`.trim();
  }

  function logsTable() {
    const campus = $('#f-campus').value;
    const cls = $('#f-class').value;
    const q = $('#f-q').value.trim().toLowerCase();
    const rows = A.logs.filter((l) => (!campus || l.campus === campus)
      && (!cls || String(l.class_no) === cls)
      && (!q || (l.name || '').toLowerCase().includes(q) || (l.username || '').includes(q)));
    if (!rows.length) return '<p class="empty">기록이 없습니다.</p>';
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>일시</th><th>구분</th><th>이름</th><th>아이디</th><th>캠퍼스·반</th><th>기기</th></tr></thead>
      <tbody>${rows.map((l) => `
        <tr class="${l.kind === 'fail' ? 'row-warn' : ''}">
          <td>${dateText(l.at, true)}</td><td>${KIND[l.kind] || esc(l.kind)}</td>
          <td>${esc(l.name || '-')}</td><td class="muted">${esc(l.username || '-')}</td>
          <td>${l.campus ? `${esc(l.campus)} ${l.class_no}반` : '-'}</td><td>${esc(shortUa(l.user_agent))}</td>
        </tr>`).join('')}</tbody></table></div>
      <p class="hint">최근 500건까지 표시합니다.</p>`;
  }

  function render() {
    document.querySelectorAll('#admin-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === A.tab));
    const rows = filtered();
    $('#admin-body').innerHTML = A.tab === 'students' ? studentsTable(rows)
      : A.tab === 'classes' ? classSummary(rows)
        : logsTable();
  }

  // ---------- 학생 상세 ----------
  async function openUser(id) {
    showScreen('admin-user');
    $('#admin-user-body').innerHTML = '<p class="empty">불러오는 중…</p>';
    try {
      const data = await Api.adminUserDetail(id);
      A.detailUser = data.user;
      const u = data.user;
      $('#admin-user-title').textContent = `${u.campus || ''} ${u.class_no ? `${u.class_no}반` : ''} ${u.name}`.trim();
      $('#admin-user-sub').textContent = `아이디 ${u.username} · 가입 ${dateText(u.created_at)}`;
      Stats.renderDashboard($('#admin-user-body'), data, { readonly: true });
      A.detailData = data;
    } catch (err) {
      if (!Account.handleError(err)) $('#admin-user-body').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  async function resetPassword() {
    const u = A.detailUser;
    if (!u) return;
    const pw = await modal({
      title: '비밀번호 초기화',
      body: `<p><b>${esc(u.name)}</b>(${esc(u.username)}) 학생의 새 비밀번호를 입력하세요. 기존 로그인은 모두 해제됩니다.</p>
             <input type="text" id="reset-pw" class="text-input" placeholder="6자 이상" autocomplete="off">`,
      buttons: [{ label: '취소', value: null }, { label: '변경', value: () => $('#reset-pw').value, primary: true }],
    });
    if (!pw) return;
    try {
      await Api.adminResetPassword(u.id, pw);
      toast('비밀번호를 변경했습니다.');
    } catch (err) {
      if (!Account.handleError(err)) toast(err.message);
    }
  }

  // ---------- CSV ----------
  function csvUsers() {
    const rows = sorted(filtered());
    downloadCsv(`SKCT_학생현황_${dateText(new Date().toISOString()).replace(/\./g, '')}.csv`, [
      ['캠퍼스', '반', '이름', '아이디', '가입일', '최근 접속', '접속 시간(분)', '로그인 횟수', '응시 횟수', '영역 기록 수',
        '푼 문항', '학습 시간(분)', '채점 문항', '정답 수', '정답률', ...SECTIONS.map((s) => `${s} 정답률`), '취약 영역'],
      ...rows.map((r) => [
        r.campus, r.class_no, r.name, r.username, dateText(r.u.created_at), r.last_seen ? dateText(r.last_seen, true) : '',
        Math.round(r.visit_sec / 60), r.login_count, r.attempts, r.st.records, r.answered, Math.round(r.study_sec / 60),
        r.graded, r.st.correct, r.st.acc == null ? '' : r.st.acc.toFixed(3),
        ...SECTIONS.map((s) => (r.st.bySection[s].acc == null ? '' : r.st.bySection[s].acc.toFixed(3))), r.weak,
      ]),
    ]);
  }

  function csvRecords() {
    const users = Object.fromEntries(A.users.map((u) => [u.id, u]));
    const recs = A.records.filter((r) => users[r.user_id]);
    downloadCsv(`SKCT_전체기록_${dateText(new Date().toISOString()).replace(/\./g, '')}.csv`, [
      ['캠퍼스', '반', '이름', '아이디', ...Stats.recordCsvHeader],
      ...recs.map((r) => {
        const u = users[r.user_id];
        return [u.campus, u.class_no, u.name, u.username, ...Stats.recordCsvRow(r)];
      }),
    ]);
  }

  // ---------- 이벤트 ----------
  function init() {
    $('#f-class').innerHTML = '<option value="">전체 반</option>' + Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join('');
    ['#f-campus', '#f-class'].forEach((s) => $(s).addEventListener('change', render));
    $('#f-q').addEventListener('input', render);
    $('#admin-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      A.tab = b.dataset.tab;
      render();
    });
    $('#admin-body').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const k = th.dataset.sort;
        A.sort = { key: k, dir: A.sort.key === k ? -A.sort.dir : 1 };
        return render();
      }
      const tr = e.target.closest('tr[data-user]');
      if (tr) openUser(tr.dataset.user);
    });
    $('#btn-admin-refresh').addEventListener('click', open);
    $('#btn-admin-csv-users').addEventListener('click', csvUsers);
    $('#btn-admin-csv-records').addEventListener('click', csvRecords);
    $('#btn-admin-back').addEventListener('click', () => showScreen('admin'));
    $('#btn-admin-reset-pw').addEventListener('click', resetPassword);
  }

  return { init, open };
})();
