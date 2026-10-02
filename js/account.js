// 로그인 · 회원가입 · 상단 사용자 메뉴 · 접속 시간 기록
window.Account = (() => {
  const { $, $$, esc, showScreen, modal, alertModal, toast } = UI;
  const HEARTBEAT_SEC = 60;

  let user = null;
  let afterLogin = () => {};
  let slackToken = null;   // Slack 로그인 직후 받은 임시 토큰 (처음 가입할 때만 사용)

  // ---------- 로그인 화면 ----------
  function setAuthTab(tab) {
    if (tab === 'signup' && Api.enabled) loadSignupInfo();
    $$('#auth-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#form-login').hidden = tab !== 'login';
    $('#form-signup').hidden = tab !== 'signup';
    $('#form-slack').hidden = true;
    $('#auth-tabs').hidden = false;
    $('#slack-box').hidden = !slackOn;
    $$('.form-err').forEach((e) => { e.hidden = true; });
    const first = $(`#form-${tab} select, #form-${tab} input`);
    if (first) first.focus();
  }

  function showError(form, msg) {
    const el = $('.form-err', form);
    el.textContent = msg;
    el.hidden = false;
  }

  async function submit(form, fn) {
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      user = await fn();
      form.reset();
      onLoggedIn();
    } catch (err) {
      showError(form, err.message);
    } finally {
      btn.disabled = false;
    }
  }

  $('#auth-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setAuthTab(b.dataset.tab);
  });

  $('#form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    submit(f, () => Api.login(f.username.value, f.password.value));
  });

  $('#form-signup').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const username = f.username.value.trim().toLowerCase();
    if (!/^[a-z0-9_]{4,20}$/.test(username)) return showError(f, '아이디는 영문 소문자·숫자·_ 4~20자로 입력해 주세요.');
    if (f.password.value.length < 6) return showError(f, '비밀번호는 6자 이상이어야 합니다.');
    if (f.password.value !== f.password2.value) return showError(f, '비밀번호 확인이 일치하지 않습니다.');
    if (!f.campus.value || !f.classNo.value) return showError(f, '캠퍼스와 반을 선택해 주세요.');
    if (!f.name.value.trim()) return showError(f, '이름을 입력해 주세요.');
    if (codeRequired && !f.code.value.trim()) return showError(f, '가입 코드를 입력해 주세요.');
    if (!f.agree.checked) return showError(f, '개인정보 수집·이용에 동의해 주세요.');
    submit(f, () => Api.signup({
      code: f.code.value.trim(),
      username,
      password: f.password.value,
      name: f.name.value.trim(),
      campus: f.campus.value,
      classNo: Number(f.classNo.value),
    }));
  });

  // ---------- Slack 로그인 ----------
  let slackOn = false;

  async function loadSlack() {
    slackOn = await Api.slackEnabled();
    if (!$('#form-slack').hidden) return;
    $('#slack-box').hidden = !slackOn;
  }

  $('#btn-slack').addEventListener('click', (e) => {
    e.preventDefault();
    location.href = Api.slackAuthorizeUrl(location.origin + location.pathname);
  });

  // Slack에서 돌아왔을 때 주소 뒤(#)에 붙은 토큰 또는 오류를 읽는다
  function readSlackReturn() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has('access_token') && !h.has('error')) return null;
    history.replaceState(null, '', location.pathname + location.search);
    if (h.has('error')) return { error: h.get('error_description') || h.get('error') };
    return { token: h.get('access_token') };
  }

  function showSlackProfile(info) {
    const f = $('#form-slack');
    f.reset();
    f.name.value = info.name || '';
    $('.slack-welcome', f).textContent = `${info.email ? `${info.email} ` : ''}Slack 계정으로 처음 오셨네요. 캠퍼스·반·이름을 확인해 주세요.`;
    $('#form-login').hidden = true;
    $('#form-signup').hidden = true;
    $('#auth-tabs').hidden = true;
    $('#slack-box').hidden = true;
    f.hidden = false;
    $('.form-err', f).hidden = true;
    showScreen('login');
  }

  async function finishSlack(ret) {
    if (ret.error) {
      requireLogin(`Slack 로그인이 취소되었거나 실패했습니다. (${ret.error})`);
      return;
    }
    try {
      const r = await Api.slackLogin(ret.token);
      if (r.needsProfile) {
        slackToken = ret.token;
        showSlackProfile(r);
        return;
      }
      user = r.user;
      onLoggedIn();
    } catch (err) {
      requireLogin(err.message);
    }
  }

  $('#form-slack').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.campus.value || !f.classNo.value) return showError(f, '캠퍼스와 반을 선택해 주세요.');
    if (!f.name.value.trim()) return showError(f, '이름을 입력해 주세요.');
    if (!f.agree.checked) return showError(f, '개인정보 수집·이용에 동의해 주세요.');
    submit(f, async () => {
      const u = await Api.slackSignup(slackToken, { name: f.name.value.trim(), campus: f.campus.value, classNo: Number(f.classNo.value) });
      slackToken = null;
      return u;
    });
  });

  $('#btn-slack-cancel').addEventListener('click', () => {
    slackToken = null;
    setAuthTab('login');
  });

  // ---------- 가입 코드 · 개인정보 안내 ----------
  let codeRequired = false;

  async function loadSignupInfo() {
    const info = await Api.signupInfo();
    codeRequired = !!info.code_required;
    $('#signup-code-row').hidden = !codeRequired;
  }

  const PRIVACY = `
    <p><b>수집 항목</b><br>아이디, 이름, 캠퍼스·반, 비밀번호(복원할 수 없는 암호화 형태), Slack으로 로그인한 경우 Slack 이메일, 응시·채점 기록, 사이트 접속 시간, 로그인 기록(일시, 브라우저 종류)</p>
    <p><b>이용 목적</b><br>본인 학습 현황 제공, SKALA 교육과정 운영(반별 학습 현황 확인)</p>
    <p><b>열람 범위</b><br>본인과 사이트 관리자(운영진)만 볼 수 있습니다. PDF 등 업로드한 문제 파일은 서버로 전송되지 않습니다.</p>
    <p><b>보관·삭제</b><br>교육과정 운영 기간 동안 보관합니다. 계정과 기록 삭제를 원하면 운영진(관리자)에게 요청하세요. 요청 시 계정과 모든 기록을 즉시 삭제합니다.</p>`;

  document.addEventListener('click', (e) => {
    if (e.target.closest('.js-privacy')) alertModal('개인정보 처리 안내', PRIVACY);
  });

  // ---------- 상단 사용자 메뉴 (설정 화면) ----------
  function renderUserBar() {
    const bar = $('#user-bar');
    if (!Api.enabled) {
      bar.innerHTML = '<span class="user-chip">오프라인 모드</span>';
      return;
    }
    if (!user) {
      bar.innerHTML = '';
      return;
    }
    const who = user.is_admin ? `${esc(user.name)} (관리자)` : `${esc(user.campus)} ${user.class_no}반 ${esc(user.name)}`;
    bar.innerHTML = `
      <span class="user-chip">${who}</span>
      <button type="button" class="tb-btn" data-go="stats">내 학습 현황</button>
      ${user.is_admin ? '<button type="button" class="tb-btn" data-go="admin">관리자</button>' : ''}
      <button type="button" class="tb-btn" id="btn-logout">로그아웃</button>`;
    $('#btn-logout').onclick = logout;
  }

  function onLoggedIn() {
    renderUserBar();
    showScreen('setup');
    afterLogin();
  }

  function requireLogin(message) {
    user = null;
    Api.clearToken();
    renderUserBar();
    setAuthTab('login');
    showScreen('login');
    if (message) toast(message);
  }

  async function logout() {
    const ok = await modal({
      title: '로그아웃',
      body: '<p>로그아웃하시겠습니까?</p>',
      buttons: [{ label: '취소', value: false }, { label: '로그아웃', value: true, primary: true }],
    });
    if (!ok) return;
    await Api.logout().catch(() => {});
    requireLogin();
  }

  // 서버 호출 중 로그인이 만료되면 로그인 화면으로
  function handleError(err) {
    if (err?.expired) {
      requireLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      return true;
    }
    return false;
  }

  // ---------- 접속 시간: 화면을 보고 있는 동안 1분마다 기록 ----------
  setInterval(() => {
    if (!user || document.visibilityState !== 'visible') return;
    Api.heartbeat(HEARTBEAT_SEC).catch(handleError);
  }, HEARTBEAT_SEC * 1000);

  // ---------- 시작 ----------
  async function init(onReady) {
    afterLogin = onReady;
    if (Api.enabled) {
      loadSignupInfo();
      loadSlack();
    }
    const slackRet = Api.enabled ? readSlackReturn() : null;
    if (slackRet) {
      await finishSlack(slackRet);
      return;
    }
    if (!Api.enabled) {
      renderUserBar();
      showScreen('setup');
      onReady();
      return;
    }
    if (Api.hasToken()) {
      try {
        user = await Api.me();
        onLoggedIn();
        return;
      } catch (err) {
        if (!err.expired) toast(err.message);
      }
    }
    requireLogin();
  }

  return {
    init,
    get user() { return user; },
    get online() { return Api.enabled && !!user; },
    requireLogin,
    handleError,
  };
})();
