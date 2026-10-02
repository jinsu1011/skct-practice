// 계산기: 위 줄은 계산 과정, 아래 줄은 결과. C는 과정과 결과를 모두 지움.
window.Calc = (() => {
  const KEYS = [
    ['C', 'clr'], ['(', 'op'], [')', 'op'], ['÷', 'op'],
    ['7'], ['8'], ['9'], ['×', 'op'],
    ['4'], ['5'], ['6'], ['−', 'op'],
    ['1'], ['2'], ['3'], ['+', 'op'],
    ['0'], ['.'], ['⌫', 'op'], ['=', 'eq'],
  ];
  const OPS = '+−×÷';

  let root, exprEl, resEl;
  let expr = '';
  let result = null;   // 직전 '=' 결과 (숫자 또는 NaN)
  let done = false;    // '=' 직후 상태

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="calc-display">
        <div class="calc-expr"></div>
        <div class="calc-res">0</div>
      </div>
      <div class="calc-keys">
        ${KEYS.map(([k, cls]) => `<button type="button" tabindex="-1" class="${cls || ''}" data-k="${k}">${k}</button>`).join('')}
      </div>`;
    exprEl = root.querySelector('.calc-expr');
    resEl = root.querySelector('.calc-res');

    // 버튼을 눌러도 포커스는 계산기에 남겨 키보드 입력을 계속 받는다
    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
      root.focus();
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (b) press(b.dataset.k);
    });
    root.addEventListener('keydown', onKey);
    render();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const map = {
      '*': '×', 'x': '×', '/': '÷', '-': '−', '+': '+',
      'Enter': '=', '=': '=', 'Backspace': '⌫',
      'Escape': 'C', 'Delete': 'C', 'c': 'C', 'C': 'C',
      '(': '(', ')': ')', '.': '.',
    };
    const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (!k) return;
    e.preventDefault();
    press(k);
  }

  const lastChar = () => expr.slice(-1);
  const isOp = (c) => OPS.includes(c);
  const isDigit = (c) => /[0-9.]/.test(c);

  function press(k) {
    if (k === 'C') {
      expr = '';
      result = null;
      done = false;
      return render();
    }

    if (done) {
      if (k === '⌫') return;
      if (isOp(k) && Number.isFinite(result)) {
        expr = toPlain(result);
      } else {
        expr = '';
      }
      done = false;
      result = null;
    }

    if (/[0-9]/.test(k)) {
      if (lastChar() === ')') expr += '×';
      expr += k;
    } else if (k === '.') {
      const num = expr.match(/[0-9.]*$/)[0];
      if (num.includes('.')) return;
      if (lastChar() === ')') expr += '×';
      expr += num === '' ? '0.' : '.';
    } else if (isOp(k)) {
      const c = lastChar();
      if (expr === '' || c === '(') {
        if (k === '−') expr += '−';
        else if (expr === '') expr = '0' + k;
      } else if (isOp(c)) {
        const prev = expr.slice(-2, -1);
        if (prev === '' || prev === '(') {
          // 맨 앞이나 '(' 뒤의 음수 부호 자리에는 '−'만 둘 수 있다
          if (k !== '−') expr = expr.slice(0, -1);
        } else {
          expr = expr.slice(0, -1) + k; // 연산자 교체
        }
      } else {
        expr += k;
      }
    } else if (k === '(') {
      const c = lastChar();
      if (c && (isDigit(c) || c === ')')) expr += '×';
      expr += '(';
    } else if (k === ')') {
      const open = (expr.match(/\(/g) || []).length;
      const close = (expr.match(/\)/g) || []).length;
      const c = lastChar();
      if (open > close && c && !isOp(c) && c !== '(') expr += ')';
    } else if (k === '⌫') {
      expr = expr.slice(0, -1);
    } else if (k === '=') {
      if (!expr) return;
      expr = tidy(expr);
      result = evaluate(expr);
      done = true;
    }
    render();
  }

  // 끝의 연산자 제거 + 열린 괄호 닫기
  function tidy(s) {
    s = s.replace(/[+−×÷(]+$/, '');
    const open = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    return s + ')'.repeat(Math.max(0, open));
  }

  function evaluate(s) {
    let i = 0;
    const peek = () => s[i];
    function num() {
      const m = /^[0-9]*\.?[0-9]*/.exec(s.slice(i))[0];
      if (!m || m === '.') throw new Error('syntax');
      i += m.length;
      return parseFloat(m);
    }
    function factor() {
      if (peek() === '−') { i++; return -factor(); }
      if (peek() === '(') {
        i++;
        const v = sum();
        if (peek() !== ')') throw new Error('syntax');
        i++;
        return v;
      }
      return num();
    }
    function product() {
      let v = factor();
      while (peek() === '×' || peek() === '÷') {
        const op = s[i++];
        const r = factor();
        v = op === '×' ? v * r : v / r;
      }
      return v;
    }
    function sum() {
      let v = product();
      while (peek() === '+' || peek() === '−') {
        const op = s[i++];
        const r = product();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    try {
      if (!s) return NaN;
      const v = sum();
      if (i !== s.length) return NaN;
      return Number.isFinite(v) ? parseFloat(v.toPrecision(12)) : NaN;
    } catch {
      return NaN;
    }
  }

  const toPlain = (n) => String(n).replace('-', '−');
  const fmt = (n) => (Number.isFinite(n)
    ? n.toLocaleString('en-US', { maximumFractionDigits: 10 }).replace('-', '−')
    : '오류');
  const pretty = (s) => s.replace(/([+×÷])/g, ' $1 ').replace(/(?<=[0-9)])−/g, ' − ');

  function render() {
    if (done) {
      exprEl.textContent = `${pretty(expr)} =`;
      resEl.textContent = fmt(result);
      resEl.classList.remove('preview');
    } else {
      exprEl.textContent = pretty(expr);
      const v = expr ? evaluate(tidy(expr)) : NaN;
      resEl.textContent = Number.isFinite(v) ? fmt(v) : '0';
      resEl.classList.toggle('preview', !!expr);
    }
    exprEl.scrollLeft = exprEl.scrollWidth;
  }

  return { init, press };
})();
