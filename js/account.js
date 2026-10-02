// 로그인 · 회원가입 · 상단 사용자 메뉴 · 접속 시간 기록
window.Account = (() => {
  const { $, $$, esc, showScreen, modal, toast } = UI;
  const HEARTBEAT_SEC = 60;

  let user = null;
  let afterLogin = () => {};

  // ---------- 로그인 화면 ----------
  function setAuthTab(tab) {
    $$('#auth-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#form-login').hidden = tab !== 'login';
    $('#form-signup').hidden = tab !== 'signup';
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
    submit(f, () => Api.signup({
      username,
      password: f.password.value,
      name: f.name.value.trim(),
      campus: f.campus.value,
      classNo: Number(f.classNo.value),
    }));
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
