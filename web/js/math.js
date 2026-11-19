// 서진이의 수학 공식 - 공식 찾아보기 화면 (로그인 없이 볼 수 있음)
// #/math            홈: 검색, 학년별, 유형별, 오늘의 공식
// #/math/g/1        학년별 목록
// #/math/c/func     유형별 목록
// #/math/f/<id>     공식 상세
import { CATS, GRADES, FORMULAS, FIGS } from './math-data.js?v=__V__';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- 수식 (KaTeX: 수식 조판 라이브러리, 처음 한 번만 받아 온다) ----------

const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
let katexLoading = null;
function loadKatex() {
  if (window.katex) return Promise.resolve();
  katexLoading ||= new Promise((resolve) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = KATEX + 'katex.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = KATEX + 'katex.min.js';
    js.onload = resolve;
    js.onerror = () => {
      katexLoading = null; // 다음에 다시 시도
      resolve(); // 못 불러와도 글자로 보여 준다
    };
    document.head.appendChild(js);
  });
  return katexLoading;
}

function tex(src, display = false) {
  if (!window.katex) return `<code class="tex-fallback">${esc(src)}</code>`;
  return window.katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, output: 'html' });
}

// 글: $수식$, **굵게**, "- " 목록, 빈 줄 = 문단
function inline(text) {
  // **굵게** 안에 수식이 들어 있을 수 있어서, 표시(\u0001)로 바꿔 두었다가 마지막에 <b> 로 바꾼다
  const html = String(text)
    .split(/(\$[^$]+\$)/g)
    .map((part) =>
      part.startsWith('$') && part.endsWith('$') && part.length > 2
        ? tex(part.slice(1, -1))
        : esc(part).replace(/\*\*/g, '\u0001').replace(/\n/g, '<br>')
    )
    .join('');
  let open = false;
  const out = html.replace(/\u0001/g, () => ((open = !open) ? '<b>' : '</b>'));
  return open ? out + '</b>' : out;
}
function rich(text) {
  return String(text || '')
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => l.trim().startsWith('- '))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.trim().slice(2))}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(block)}</p>`;
    })
    .join('');
}

// 화면보다 넓은 수식은 글자 크기를 조금씩 줄여 한 줄에 맞춘다 (최소 60%, 그래도 넓으면 옆으로 밀어서 보기)
function fitMath(root = document) {
  root.querySelectorAll('.katex-display').forEach((el) => {
    el.style.fontSize = '';
    for (let size = 95; el.scrollWidth > el.clientWidth + 1 && size >= 60; size -= 5) el.style.fontSize = `${size}%`;
  });
}

// ---------- 유형 아이콘 (흰 선 그림, 바탕은 유형 색) ----------

const S = 'fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"';
export const CAT_ICONS = {
  num: `<svg viewBox="0 0 48 48"><g ${S}><path d="M10 15h12M16 9v12M27 15h12M11 29l9 9M20 29l-9 9M27 34h12"/></g><g fill="#fff"><circle cx="33" cy="28.5" r="2.4"/><circle cx="33" cy="39.5" r="2.4"/></g></svg>`,
  expr: `<svg viewBox="0 0 48 48"><text x="6" y="37" font-size="30" font-weight="800" font-style="italic" font-family="Georgia,serif" fill="#fff">x</text><text x="25" y="21" font-size="17" font-weight="800" font-family="Georgia,serif" fill="#fff">2</text><path ${S} d="M33 33h9M37.5 28.5v9"/></svg>`,
  eq: `<svg viewBox="0 0 48 48"><g ${S}><path d="M24 8v30M15 41h18M9 15h30"/><path d="M9 15l-5 11h10zM39 15l-5 11h10z" fill="#fff" fill-opacity=".35"/></g></svg>`,
  func: `<svg viewBox="0 0 48 48"><g ${S}><path d="M8 41h33M8 41V7M37 37l4 4-4 4M4 11l4-4 4 4" stroke-width="3"/><path d="M13 9q12 46 25 0" stroke-width="3.5"/></g></svg>`,
  plane: `<svg viewBox="0 0 48 48"><g ${S}><path d="M6 39L19 11l13 28z" fill="#fff" fill-opacity=".3"/><circle cx="33" cy="30" r="10"/></g></svg>`,
  solid: `<svg viewBox="0 0 48 48"><g ${S}><path d="M9 18h20v21H9z" fill="#fff" fill-opacity=".3"/><path d="M9 18l9-9h20l-9 9M38 9v21l-9 9"/></g></svg>`,
  trig: `<svg viewBox="0 0 48 48"><g ${S}><path d="M7 40h33V10z" fill="#fff" fill-opacity=".25"/><path d="M34 40v-6h6" stroke-width="2.5"/><path d="M17 40a10 10 0 0 0-1.6-5.5" stroke-width="2.5"/></g><text x="16" y="33" font-size="11" font-weight="800" font-family="Georgia,serif" font-style="italic" fill="#fff">θ</text></svg>`,
  circle: `<svg viewBox="0 0 48 48"><g ${S}><circle cx="24" cy="24" r="17"/><path d="M24 7L10 34M24 7l14 27" stroke-width="2.8"/><path d="M10 34l14-10 14 10" stroke-width="2.2" stroke-dasharray="3 3"/></g><circle cx="24" cy="24" r="2.8" fill="#fff"/></svg>`,
  stat: `<svg viewBox="0 0 48 48"><g fill="none" stroke="#fff" stroke-linecap="round"><path d="M11 41V28M20 41V17M29 41V24M38 41V9" stroke-width="6"/><path d="M5 44h38" stroke-width="2.5"/></g></svg>`,
};

const icon = (c, cls = '') => `<span class="m-icon ${cls}" style="--c:${CATS[c].color}">${CAT_ICONS[c]}</span>`;

// ---------- 공통 조각 ----------

const BACK_KEY = 'mathBack';
function setBack(path) {
  try {
    sessionStorage.setItem(BACK_KEY, path);
  } catch {}
}
function getBack(fallback) {
  try {
    return sessionStorage.getItem(BACK_KEY) || fallback;
  } catch {
    return fallback;
  }
}

function mtop(ctx, title, back) {
  return `
    <div class="topbar m-topbar">
      <a class="btn icon ghost" href="#${back}" aria-label="뒤로">←</a>
      <h1>${esc(title)}</h1>
      ${ctx.themeSwitch()}
    </div>`;
}

// 목록에 보여 줄 짧은 수식 (표·연립식처럼 큰 건 빼고)
const preview = (f) => (/array|cases/.test(f.f) || f.f.length > 90 ? '' : `<span class="m-item-f">${tex(f.f)}</span>`);

function item(f, { showGrade = false } = {}) {
  return `
    <a class="m-item" href="#/math/f/${f.id}" style="--c:${CATS[f.c].color}">
      ${icon(f.c, 'sm')}
      <span class="m-item-main">
        <b>${esc(f.t)}${showGrade ? ` <span class="m-grade-tag">${GRADES[f.g].short}</span>` : ''}</b>
        ${preview(f)}
      </span>
      <span class="m-chev">›</span>
    </a>`;
}

// 오늘의 공식: 날짜마다 바뀜
function todays() {
  const d = new Date();
  const n = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  return FORMULAS[n % FORMULAS.length];
}

function search(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return FORMULAS.filter((f) => {
    const hay = `${f.t} ${f.k || ''} ${CATS[f.c].name} ${GRADES[f.g].short} ${f.d}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------- 홈 ----------

export async function viewMathHome(ctx) {
  await loadKatex();
  if (!ctx.isCurrent()) return;
  setBack('/math');
  const t = todays();
  const count = (pred) => FORMULAS.filter(pred).length;
  const sections = `
    <div class="section-title">학년별로 보기</div>
    <div class="m-grades">
      ${Object.entries(GRADES)
        .map(
          ([g, info]) => `
        <a class="m-grade" href="#/math/g/${g}" style="--c:${info.color}">
          <span class="m-grade-big">${info.short}</span>
          <span class="m-grade-count">공식 ${count((f) => f.g === Number(g))}개</span>
          <span class="m-grade-topics">${esc(info.topics)}</span>
        </a>`
        )
        .join('')}
    </div>
    <div class="section-title">유형별로 보기</div>
    <div class="m-cats">
      ${Object.entries(CATS)
        .map(
          ([c, info]) => `
        <a class="m-cat" href="#/math/c/${c}" style="--c:${info.color}">
          ${icon(c)}
          <b>${esc(info.name)}</b>
          <span>${count((f) => f.c === c)}개</span>
        </a>`
        )
        .join('')}
    </div>
    <div class="section-title">✨ 오늘의 공식</div>
    <a class="m-today" href="#/math/f/${t.id}" style="--c:${CATS[t.c].color}">
      <div class="m-today-head">${icon(t.c, 'sm')}<span><b>${esc(t.t)}</b><br><span class="small">${GRADES[t.g].short} · ${esc(CATS[t.c].name)}</span></span></div>
      <div class="m-today-f">${tex(t.f, true)}</div>
      <div class="m-today-ex">${esc(t.ex.t)} →</div>
    </a>`;

  ctx.$app.innerHTML = `
    ${mtop(ctx, '서진이의 수학 공식', ctx.loggedIn ? '/' : '/login')}
    <section class="m-hero">
      <span class="m-deco" aria-hidden="true"><i>π</i><i>√</i><i>∞</i><i>Σ</i><i>÷</i><i>x²</i></span>
      <div class="m-hero-title">📐 서진이의 수학 공식</div>
      <div class="m-hero-sub">중학교 수학 공식 ${FORMULAS.length}개 · 뜻, 재미있는 예시, 숨은 이야기까지</div>
      <input id="mq" type="search" placeholder="공식 찾기 (예: 근의 공식, 피타고라스, 부피)" autocomplete="off">
    </section>
    <div id="mbody">${sections}</div>`;
  fitMath(ctx.$app);

  const $q = document.getElementById('mq');
  const $body = document.getElementById('mbody');
  $q.oninput = () => {
    const q = $q.value.trim();
    if (!q) {
      $body.innerHTML = sections;
      return;
    }
    const found = search(q);
    $body.innerHTML = `
      <div class="section-title">'${esc(q)}' 검색 결과 ${found.length}개</div>
      ${found.length ? `<div class="m-list">${found.map((f) => item(f, { showGrade: true })).join('')}</div>` : '<div class="card empty">찾는 공식이 없어요. 다른 말로 찾아볼까요?</div>'}`;
  };
}

// ---------- 목록 (학년별 / 유형별) ----------

export async function viewMathList(ctx, kind, key) {
  await loadKatex();
  if (!ctx.isCurrent()) return;
  setBack(`/math/${kind}/${key}`);
  let head;
  let groups;
  if (kind === 'g') {
    const g = Number(key);
    const info = GRADES[g];
    if (!info) return ctx.go('/math');
    head = `
      <div class="m-banner" style="--c:${info.color}">
        <span class="m-banner-big">${info.short}</span>
        <div><b>${esc(info.name)}</b><br><span>${esc(info.topics)}</span></div>
      </div>`;
    groups = Object.keys(CATS)
      .map((c) => ({ title: `${icon(c, 'xs')} ${esc(CATS[c].name)}`, list: FORMULAS.filter((f) => f.g === g && f.c === c) }))
      .filter((x) => x.list.length);
  } else {
    const info = CATS[key];
    if (!info) return ctx.go('/math');
    head = `
      <div class="m-banner" style="--c:${info.color}">
        ${icon(key, 'lg')}
        <div><b>${esc(info.name)}</b><br><span>${esc(info.desc)}</span></div>
      </div>`;
    groups = [1, 2, 3]
      .map((g) => ({ title: `<span class="m-grade-tag">${GRADES[g].short}</span> ${esc(GRADES[g].name)}`, list: FORMULAS.filter((f) => f.c === key && f.g === g) }))
      .filter((x) => x.list.length);
  }
  ctx.$app.innerHTML = `
    ${mtop(ctx, kind === 'g' ? GRADES[key].name : CATS[key].name, '/math')}
    ${head}
    ${groups
      .map(
        (grp) => `
      <div class="section-title m-group-title">${grp.title}</div>
      <div class="m-list">${grp.list.map((f) => item(f)).join('')}</div>`
      )
      .join('')}
    ${kind === 'g' ? '<p class="small muted center" style="margin-top:20px">학년은 교과서·교육과정에 따라 조금 다를 수 있어요.</p>' : ''}`;
}

// ---------- 상세 ----------

export async function viewMathDetail(ctx, id) {
  const f = FORMULAS.find((x) => x.id === id);
  if (!f) return ctx.go('/math');
  await loadKatex();
  if (!ctx.isCurrent()) return;
  const cat = CATS[f.c];
  // 같은 유형 안에서 학년 순서대로 이전/다음
  const same = FORMULAS.filter((x) => x.c === f.c).sort((a, b) => a.g - b.g);
  const i = same.indexOf(f);
  const prev = same[i - 1];
  const next = same[i + 1];

  ctx.$app.innerHTML = `
    ${mtop(ctx, '공식 자세히 보기', getBack(`/math/c/${f.c}`))}
    <article class="m-detail" style="--c:${cat.color}">
      <header class="m-head">
        <span class="m-deco" aria-hidden="true"><i>π</i><i>√</i><i>∞</i><i>Σ</i></span>
        ${icon(f.c, 'xl')}
        <div class="m-chips">
          <a href="#/math/g/${f.g}">${GRADES[f.g].short}</a>
          <a href="#/math/c/${f.c}">${esc(cat.name)}</a>
        </div>
        <h2 class="m-title">${esc(f.t)}</h2>
        ${f.note ? `<div class="m-note">📚 ${esc(f.note)}</div>` : ''}
      </header>

      <section class="m-formula">
        <div class="m-label">공식</div>
        <div class="m-formula-main">${tex(f.f, true)}</div>
        ${(f.fx || []).map((x) => `<div class="m-formula-sub">${tex(x, true)}</div>`).join('')}
      </section>

      ${f.fig ? `<section class="m-fig">${FIGS[f.fig]}</section>` : ''}

      <section class="m-sec">
        <h3>💡 무슨 뜻이에요?</h3>
        ${rich(f.d)}
      </section>

      <section class="m-sec m-example">
        <h3>${esc(f.ex.t)}</h3>
        ${rich(f.ex.s)}
        ${f.ex.c?.length ? `<div class="m-notebook">${f.ex.c.map((line) => `<div class="m-line">${tex(line, true)}</div>`).join('')}</div>` : ''}
      </section>

      ${f.memo ? `<section class="m-sec m-memo"><h3>🧠 외우는 꿀팁</h3>${rich(f.memo)}</section>` : ''}

      <section class="m-sec m-story">
        <h3>📜 알고 보면 재밌는 이야기</h3>
        ${rich(f.tip)}
      </section>

      <nav class="m-nav">
        ${prev ? `<a href="#/math/f/${prev.id}"><span>← 이전 공식</span><b>${esc(prev.t)}</b></a>` : '<span></span>'}
        ${next ? `<a class="next" href="#/math/f/${next.id}"><span>다음 공식 →</span><b>${esc(next.t)}</b></a>` : '<span></span>'}
      </nav>

      <div class="section-title">${icon(f.c, 'xs')} ${esc(cat.name)}의 다른 공식</div>
      <div class="m-related">
        ${same
          .filter((x) => x !== f)
          .map((x) => `<a href="#/math/f/${x.id}">${esc(x.t)} <span class="m-grade-tag">${GRADES[x.g].short}</span></a>`)
          .join('')}
      </div>
    </article>`;
  fitMath(ctx.$app);
}
