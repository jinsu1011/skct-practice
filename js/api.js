// 서버(Supabase RPC) 호출. 테이블 직접 접근은 막혀 있고 supabase/schema.sql의 함수만 호출한다.
window.Api = (() => {
  const cfg = window.SKCT_CONFIG || {};
  const base = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const key = cfg.supabaseKey || '';
  const enabled = !!(base && key);
  const TOKEN_KEY = 'skct-token';

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* 저장 불가 환경 */ }

  function setToken(t) {
    token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* 저장 불가 환경 */ }
  }

  async function rpc(fn, args = {}) {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // 예전 형식(JWT) anon 키
    let res;
    try {
      res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    } catch {
      throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.message || `서버 오류 (${res.status})`);
      err.code = data?.code;
      err.expired = data?.code === 'P0401';
      throw err;
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  const authed = (fn, args = {}) => rpc(fn, { p_token: token, ...args });
  const ua = () => navigator.userAgent.slice(0, 300);

  async function signup({ username, password, name, campus, classNo, code }) {
    const args = { p_username: username, p_password: password, p_name: name, p_campus: campus, p_class: classNo, p_ua: ua() };
    if (code) args.p_code = code;
    const r = await rpc('signup', args);
    setToken(r.token);
    return r.user;
  }

  async function login(username, password) {
    const r = await rpc('login', { p_username: username, p_password: password, p_ua: ua() });
    setToken(r.token);
    return r.user;
  }

  async function logout() {
    try { if (token) await authed('logout'); } finally { setToken(null); }
  }

  return {
    enabled,
    hasToken: () => !!token,
    signup,
    login,
    logout,
    clearToken: () => setToken(null),
    me: () => authed('me'),
    changePassword: (oldPw, newPw) => authed('change_password', { p_old: oldPw, p_new: newPw }),
    heartbeat: (sec) => authed('heartbeat', { p_seconds: sec }),
    saveAttempt: (sections, source, external) => authed('save_attempt', {
      p_sections: sections,
      p_source: source || null,
      ...(external ? { p_external: true } : {}),
    }),
    signupInfo: () => rpc('signup_info').catch(() => ({ code_required: false })),
    deleteAccount: (password) => authed('delete_account', { p_password: password }),
    grade: (id, answerKey) => authed('grade_record', { p_id: id, p_key: answerKey }),
    deleteAttempt: (attemptId) => authed('delete_attempt', { p_attempt: attemptId }),
    myData: () => authed('my_data'),
    adminUsers: () => authed('admin_users'),
    adminRecords: () => authed('admin_records'),
    adminUserDetail: (userId) => authed('admin_user_detail', { p_user: userId }),
    adminLogs: (limit = 300) => authed('admin_logs', { p_limit: limit }),
    adminResetPassword: (userId, pw) => authed('admin_reset_password', { p_user: userId, p_new: pw }),
    adminSettings: () => authed('admin_settings'),
    adminSetSignupCode: (code) => authed('admin_set_signup_code', { p_code: code }),
    adminDeleteUser: (userId) => authed('admin_delete_user', { p_user: userId }),
  };
})();
