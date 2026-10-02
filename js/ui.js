// 여러 화면에서 같이 쓰는 도우미: DOM 선택, 화면 전환, 팝업, 토스트, 포맷, 저장소, CSV
window.UI = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const mmss = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  };

  // 1시간 20분 / 35분 / 40초
  const duration = (sec) => {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h) return `${h}시간 ${m}분`;
    if (m) return `${m}분`;
    return `${sec}초`;
  };

  const pct = (v, digits = 0) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(digits)}%`);

  const dateText = (iso, withTime = false) => {
    if (!iso) return '-';
    const d = new Date(iso);
    const s = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    return withTime ? `${s} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : s;
  };

  const store = {
    get(k) {
      try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ }
    },
    remove(k) {
      try { localStorage.removeItem(k); } catch { /* 저장 불가 환경 */ }
    },
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
      el.onclick = () => closeModal(typeof b.value === 'function' ? b.value() : b.value);
      return el;
    }));
    $('#modal').hidden = false;
    const first = $('#modal-body input');
    (first || box.lastElementChild).focus();
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
    toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
  }

  // ---------- CSV (엑셀에서 한글이 깨지지 않도록 BOM 포함) ----------
  function downloadCsv(filename, rows) {
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- 차트 툴팁: data-tip 속성이 있는 요소에 마우스를 올리면 표시 ----------
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  document.addEventListener('DOMContentLoaded', () => document.body.append(tip));
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const w = tip.offsetWidth;
    const x = Math.min(e.clientX + 14, window.innerWidth - w - 8);
    tip.style.transform = `translate(${x}px, ${e.clientY + 16}px)`;
  });

  return { $, $$, esc, mmss, duration, pct, dateText, store, showScreen, modal, closeModal, alertModal, toast, downloadCsv };
})();
