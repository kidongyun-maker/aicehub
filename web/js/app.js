// 단어 암기장 - 단일 페이지 앱 (해시 라우팅, 데이터는 Supabase)
import * as db from './db.js?v=__V__';
import { recognizeWords, mergePages, EDGE_ROWS } from './ocr.js?v=__V__';
import { AI_EXTRACT_ENABLED } from './config.js?v=__V__';
import { voiceSupported, listen, toSpelling } from './voice.js?v=__V__';

const $app = document.getElementById('app');
const state = { me: null, passRate: 80 };

const STEP_INFO = {
  learn: { no: 1, name: '단어 암기', short: '암기', desc: '카드를 넘기며 단어와 뜻을 외워요' },
  quiz: { no: 2, name: '뜻 맞추기', short: '뜻', desc: '5개 보기 중 알맞은 뜻을 골라요' },
  spell: { no: 3, name: '스펠링 맞추기', short: '스펠링', desc: '섞인 알파벳을 순서대로 눌러요' },
  meaning_write: { no: 4, name: '뜻 직접 쓰기', short: '뜻 쓰기', desc: '영어 단어를 보고 뜻을 직접 써요 (🎤 말로도 돼요)' },
  spell_write: { no: 5, name: '스펠링 직접 쓰기', short: '스펠링 쓰기', desc: '뜻을 보고 영어 단어를 직접 써요 (🎤 말로도 돼요)' },
  final: { no: 6, name: '최종 테스트', short: '최종', desc: '뜻·스펠링을 섞어서 시험 봐요' },
};
const STEP_ORDER = ['learn', 'quiz', 'spell', 'meaning_write', 'spell_write', 'final'];
const TEST_STEPS = STEP_ORDER.slice(1);
const NUM = ['', '①', '②', '③', '④', '⑤', '⑥'];

// 뜻 직접 쓰기 채점 - DB 함수 meaning_matches 와 같은 규칙 (화면에 바로 보여 주기용, 최종 채점은 DB)
// 뜻 중 하나만 맞게 써도 정답. 띄어쓰기·~·괄호 무시, '하다' 차이 허용.
function meaningMatches(answer, meaning) {
  const strip = (t) => t.replace(/[\s~·.,!?'"()[\]-]/g, '').toLowerCase();
  const forms = (t) => [strip(t), strip(t.replace(/\([^)]*\)/g, ''))];
  const parts = (t) => String(t ?? '').split(/[,;/]/).flatMap(forms).filter(Boolean);
  const means = parts(meaning);
  return parts(answer).some((a) => means.some((m) => a === m || a + '하다' === m || a === m + '하다'));
}

// ---------- 유틸 ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('en-US')) ||
    speechSynthesis.getVoices().find((v) => v.lang?.startsWith('en'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

const go = (path) => {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
};

const loading = (msg = '불러오는 중...') => `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;

function roleBadge(user) {
  return `<span class="badge ${user.role}">${user.role === 'parent' ? '부모' : '학생'} ${esc(user.code)}</span>`;
}

function topbar(title, { back } = {}) {
  return `
    <div class="topbar">
      ${back ? `<a class="btn icon ghost" href="#${back}" aria-label="뒤로">←</a>` : ''}
      <h1>${esc(title)}</h1>
      ${roleBadge(state.me)}
    </div>`;
}

// 사진을 최대 1600px JPEG로 줄인다 (업로드 용량 + AI 처리 속도).
async function resizeImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('이 사진 형식은 열 수 없습니다. JPG/PNG 사진을 올려 주세요.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 학습 단계: 잠금 없이 어느 단계든 바로 할 수 있다(건너뛰기 가능).
// current = 아직 안 한 첫 단계 (추천 표시용)
function stepState(summary) {
  const done = { learn: Boolean(summary.learnedAt), final: Boolean(summary.passed) };
  for (const k of TEST_STEPS) if (k !== 'final') done[k] = Boolean(summary[k]);
  const current = STEP_ORDER.find((k) => !done[k]) || null;
  return { done, current };
}

function chipsFor(summary) {
  const pct = (s) => (s ? `${s.lastAccuracy}%` : '–');
  const cls = (s) => (!s ? '' : s.lastAccuracy >= state.passRate ? 'done' : 'low');
  return `
    <div class="chips">
      <span class="chip ${summary.learnedAt ? 'done' : ''}">① 암기 ${summary.learnedAt ? '✓' : '–'}</span>
      ${['quiz', 'spell', 'meaning_write', 'spell_write']
        .map((k) => `<span class="chip ${cls(summary[k])}">${NUM[STEP_INFO[k].no]} ${STEP_INFO[k].short} ${pct(summary[k])}</span>`)
        .join('')}
      ${
        summary.passed
          ? `<span class="chip pass">⑥ 통과 ${summary.final.lastAccuracy}%</span>`
          : `<span class="chip ${cls(summary.final)}">⑥ 최종 ${pct(summary.final)}</span>`
      }
    </div>`;
}

// ---------- 라우터 ----------

const routes = [
  [/^\/login$/, viewLogin, { public: true }],
  [/^\/$/, viewHome],
  [/^\/report$/, viewReport],
  [/^\/new$/, viewNew],
  [/^\/set\/([a-f0-9-]{36})$/, viewSet],
  [/^\/set\/([a-f0-9-]{36})\/edit$/, viewEdit],
  [/^\/set\/([a-f0-9-]{36})\/learn$/, viewLearn],
  [/^\/set\/([a-f0-9-]{36})\/run\/(quiz|spell|meaning_write|spell_write|final)$/, viewRun],
  [/^\/set\/([a-f0-9-]{36})\/result\/([a-f0-9-]{36})$/, viewResult],
];

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  if (window.speechSynthesis) speechSynthesis.cancel();
  window.onkeydown = null;

  if (!state.me && path !== '/login') return go('/login');
  if (state.me && path === '/login') return go('/');

  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      $app.innerHTML = loading();
      window.scrollTo(0, 0);
      try {
        await view({ params: m.slice(1), query, isCurrent: () => seq === renderSeq });
      } catch (err) {
        if (seq !== renderSeq || !state.me) return;
        $app.innerHTML = `${topbar('오류', { back: '/' })}<div class="card empty">${esc(err.message)}</div>`;
      }
      return;
    }
  }
  go('/');
}

// ---------- 로그인 ----------

async function viewLogin() {
  $app.innerHTML = `
    <form class="login" id="f" autocomplete="off">
      <div class="logo">📘</div>
      <h1>서진이의 단어 암기장</h1>
      <p class="muted">사용자 번호 4자리를 입력하세요</p>
      <input id="code" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" aria-label="사용자 번호" autofocus>
      <div class="error" id="err"></div>
      <button class="btn primary block" type="submit">시작하기</button>
    </form>`;
  const $code = document.getElementById('code');
  const $err = document.getElementById('err');
  const submit = async () => {
    $err.textContent = '';
    try {
      const { user } = await db.login($code.value);
      state.me = user;
      go('/');
    } catch (err) {
      $err.textContent = err.message;
      $code.value = '';
      $code.focus();
    }
  };
  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    submit();
  };
  $code.oninput = () => {
    $code.value = $code.value.replace(/\D/g, '');
    if ($code.value.length === 4) submit();
  };
}

async function logout() {
  await db.logout();
  state.me = null;
  go('/login');
}

// ---------- 홈 ----------

function homeHeader(active) {
  return `
    <div class="topbar">
      <h1>📘 단어 암기장</h1>
      ${roleBadge(state.me)}
      <button class="btn small ghost" id="logout">로그아웃</button>
    </div>
    <nav class="tabs">
      <a href="#/" class="${active === 'home' ? 'active' : ''}">단어장</a>
      <a href="#/report" class="${active === 'report' ? 'active' : ''}">${state.me.role === 'parent' ? '성적표 (학생·부모)' : '내 성적표'}</a>
    </nav>`;
}

async function viewHome({ isCurrent }) {
  const { sets } = await db.listSets();
  if (!isCurrent()) return;
  $app.innerHTML = `
    ${homeHeader('home')}
    <a class="add-card" href="#/new">
      <span class="plus">📷</span>
      <span>사진으로 단어장 만들기<small>교재·단어장 사진을 찍어 올리면 단어와 뜻을 정리해요</small></span>
    </a>
    <div class="section-title">내 단어장 ${sets.length ? `(${sets.length})` : ''}</div>
    ${
      sets.length === 0
        ? `<div class="card empty">아직 단어장이 없어요.<br>위 버튼으로 첫 단어장을 만들어 보세요.</div>`
        : sets
            .map(
              (s) => `
        <a class="card set-card" href="#/set/${s.id}">
          <div class="row between">
            <span class="title">${esc(s.title)}</span>
            ${s.summary.passed ? '<span class="badge good">통과</span>' : ''}
          </div>
          <div class="meta">단어 ${s.wordCount}개 · ${esc(s.createdByName)} 등록 · ${fmtDate(s.createdAt)}</div>
          ${chipsFor(s.summary)}
        </a>`
            )
            .join('')
    }`;
  document.getElementById('logout').onclick = logout;
}

// ---------- 성적표 ----------

async function viewReport({ isCurrent }) {
  const data = await db.getReport();
  if (!isCurrent()) return;
  const { users, sets, passRate } = data;

  const totals = users.map((u) => {
    const finals = sets.map((s) => s.byUser[u.code]).filter((x) => x.final);
    const passed = sets.filter((s) => s.byUser[u.code].passed).length;
    const avg = finals.length ? Math.round(finals.reduce((a, x) => a + x.final.lastAccuracy, 0) / finals.length) : null;
    return { u, passed, tested: finals.length, avg };
  });

  $app.innerHTML = `
    ${homeHeader('report')}
    ${totals
      .map(
        (t) => `
      <div class="card">
        <h2>${esc(t.u.name)} <span class="small muted">${esc(t.u.code)}</span></h2>
        <div class="summary-tiles">
          <div class="tile-s"><div class="v">${t.passed}/${sets.length}</div><div class="k">통과한 단어장</div></div>
          <div class="tile-s"><div class="v">${t.tested}</div><div class="k">응시한 단어장</div></div>
          <div class="tile-s"><div class="v">${t.avg === null ? '–' : `${t.avg}%`}</div><div class="k">최종 평균</div></div>
        </div>
      </div>`
      )
      .join('')}
    <div class="section-title">단어장별 결과 · 최종 테스트 ${passRate}% 이상이면 통과</div>
    ${
      sets.length === 0
        ? '<div class="card empty">아직 단어장이 없어요.</div>'
        : sets
            .map(
              (s) => `
      <div class="card report-set">
        <a href="#/set/${s.id}" class="head">
          <b>${esc(s.title)}</b><span class="small muted">단어 ${s.wordCount}개</span>
        </a>
        <div class="report-grid">
          ${users
            .map((u) => {
              const x = s.byUser[u.code];
              const f = x.final;
              return `
              <a class="report-user" href="#/set/${s.id}?user=${u.code}">
                <span class="badge ${u.role}">${esc(u.name)}</span>
                <div>
                  ${chipsFor(x)}
                  <div class="small muted" style="margin-top:4px">${x.lastActivity ? `최근 학습 ${fmtDate(x.lastActivity)}` : '아직 학습 전'}</div>
                </div>
                <div class="final">
                  ${f ? `<b>${f.lastAccuracy}%</b><br>` : '<b>–</b><br>'}
                  ${x.passed ? '<span class="badge good">통과</span>' : f ? '<span class="badge bad">미통과</span>' : '<span class="badge">미응시</span>'}
                </div>
              </a>`;
            })
            .join('')}
        </div>
      </div>`
            )
            .join('')
    }`;
  document.getElementById('logout').onclick = logout;
}

// ---------- 단어장 만들기 / 편집 ----------

function parseBulk(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.+?)\s*(?:\t|\s-\s|:|=|,|\s{2,})\s*(.+)$/) || line.match(/^([A-Za-z][A-Za-z\s'.-]*?)\s+([^A-Za-z].*)$/);
      return m ? { word: m[1].trim(), meaning: m[2].trim() } : null;
    })
    .filter(Boolean);
}

// 단어 편집 표. words: [{id?, word, meaning, inferred?}]
function mountEditor(container, words) {
  let rows = words.map((w) => ({ ...w }));
  const draw = () => {
    container.innerHTML = `
      <table class="word-editor">
        <tbody>
          ${rows
            .map(
              (r, i) => `
            <tr class="${r.inferred ? 'inferred' : ''} ${r.word && !r.meaning ? 'missing' : ''}">
              <td class="num">${i + 1}</td>
              <td><input type="text" class="word" data-i="${i}" value="${esc(r.word)}" placeholder="영어 단어" autocapitalize="off" autocorrect="off" spellcheck="false"></td>
              <td><input type="text" class="meaning" data-i="${i}" value="${esc(r.meaning)}" placeholder="뜻"></td>
              <td class="del"><button class="btn icon ghost small" data-del="${i}" aria-label="삭제">✕</button></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <div class="row between" style="margin-top:8px">
        <button class="btn small" id="addRow">+ 단어 추가</button>
        ${rows.some((r) => r.inferred) ? '<span class="legend"><span class="swatch"></span> 사진에 뜻이 없어 AI가 채운 뜻 · 확인해 주세요</span>' : ''}
      </div>
      <details class="bulk">
        <summary>여러 줄 한 번에 붙여넣기</summary>
        <textarea id="bulk" placeholder="apple - 사과&#10;banana : 바나나&#10;look after	돌보다"></textarea>
        <button class="btn small" id="bulkAdd" style="margin-top:8px">목록에 추가</button>
      </details>`;
    container.querySelectorAll('input').forEach((input) => {
      input.oninput = () => {
        const r = rows[input.dataset.i];
        r[input.classList.contains('word') ? 'word' : 'meaning'] = input.value;
        if (input.classList.contains('meaning')) {
          r.inferred = false;
          input.closest('tr').classList.remove('inferred', 'missing');
        }
      };
    });
    container.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        rows.splice(Number(b.dataset.del), 1);
        draw();
      };
    });
    container.querySelector('#addRow').onclick = () => {
      rows.push({ word: '', meaning: '' });
      draw();
      container.querySelectorAll('input.word').item(rows.length - 1)?.focus();
    };
    container.querySelector('#bulkAdd').onclick = () => {
      const parsed = parseBulk(container.querySelector('#bulk').value);
      if (!parsed.length) return toast('"단어 - 뜻" 형식으로 한 줄에 하나씩 적어 주세요.');
      rows = [...rows.filter((r) => r.word.trim() || r.meaning.trim()), ...parsed];
      draw();
      toast(`${parsed.length}개 추가했어요.`);
    };
  };
  draw();
  return {
    get: () => rows.map((r) => ({ id: r.id, word: r.word.trim(), meaning: r.meaning.trim() })),
    hasEmpty: () => rows.some((r) => !r.word.trim() !== !r.meaning.trim()),
  };
}

const MAX_PHOTOS = 10;

async function viewNew() {
  let images = []; // 올린 사진 (data URL)
  let readCount = 0; // 앞에서부터 몇 장까지 단어를 읽었는지
  const edgeWords = new Set(); // 사진 맨 위 줄(반쯤 잘리기 쉬움)에서 읽은 단어
  $app.innerHTML = `
    ${topbar('새 단어장', { back: '/' })}
    <div class="stack">
      <div class="card">
        <h2>1. 사진 올리기</h2>
        <label class="photo-drop" id="drop">
          <span class="big">📷</span>
          <b>사진 찍기 / 앨범에서 선택</b>
          <span class="small muted">여러 장을 한 번에 골라도 돼요 (최대 ${MAX_PHOTOS}장)</span>
          <input type="file" id="file" accept="image/*" multiple hidden>
        </label>
        <div class="photo-strip" id="strip" hidden></div>
        <div class="row" style="margin-top:12px" id="photoActions" hidden>
          <button class="btn" id="addPhoto">＋ 사진 추가</button>
          <button class="btn primary" id="ocr" style="flex:1">🔍 전체 다시 인식</button>
          ${AI_EXTRACT_ENABLED ? '<button class="btn" id="ai">✨ AI로 정확하게</button>' : ''}
        </div>
        <div id="extractStatus"></div>
      </div>
      <div class="card">
        <h2>2. 단어 확인·수정</h2>
        <input type="text" id="title" placeholder="단어장 이름 (예: 3과 단어)" maxlength="60" style="margin-bottom:12px">
        <div id="editor"></div>
      </div>
      <button class="btn primary block" id="save" style="min-height:52px">저장하고 학습 시작</button>
    </div>`;

  let editor = mountEditor(document.getElementById('editor'), [{ word: '', meaning: '' }]);
  const $file = document.getElementById('file');
  const $strip = document.getElementById('strip');
  const $drop = document.getElementById('drop');
  const $ocr = document.getElementById('ocr');
  const $ai = document.getElementById('ai');
  const $status = document.getElementById('extractStatus');
  const status = (html) => ($status.innerHTML = html);
  const note = (msg, bad = false) =>
    status(`<p class="small" style="margin:8px 0 0${bad ? ';color:var(--bad)' : ''}">${msg}</p>`);

  const renderStrip = () => {
    $strip.innerHTML = images
      .map((src, i) => `<div class="ph"><img src="${src}" alt="사진 ${i + 1}"><span class="n">${i + 1}</span><button type="button" class="x" data-i="${i}" aria-label="사진 ${i + 1} 빼기">×</button></div>`)
      .join('');
    const has = images.length > 0;
    $strip.hidden = !has;
    $drop.hidden = has;
    document.getElementById('photoActions').hidden = !has;
    $ocr.textContent = images.length > 1 ? '🔍 전체 다시 인식' : '🔍 다시 인식';
  };
  $strip.onclick = (e) => {
    const i = e.target.closest('.x')?.dataset.i;
    if (i === undefined || busy) return;
    images.splice(Number(i), 1);
    readCount = Math.min(readCount, images.length);
    renderStrip();
    note('사진을 뺐어요. 이미 읽은 단어는 아래 표에 그대로 있으니, 필요 없으면 지워 주세요.');
  };

  $file.onchange = async () => {
    const files = [...$file.files];
    $file.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - images.length;
    if (files.length > room) toast(`사진은 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        images.push(await resizeImage(file));
      } catch (err) {
        toast(err.message);
      }
    }
    renderStrip();
    readNew();
  };
  document.getElementById('addPhoto').onclick = () => $file.click();

  // 지금 표에 있는 단어 (빈 줄 제외)
  const currentWords = () => editor.get().filter((w) => w.word || w.meaning);

  const showResult = (words, how, added) => {
    if (!words.length) {
      return note('단어를 찾지 못했어요. 더 밝고 반듯하게 찍어 다시 올리거나 직접 입력해 주세요.', true);
    }
    editor = mountEditor(document.getElementById('editor'), words);
    const missing = words.filter((w) => !w.meaning).length;
    note(
      `✅ ${how}으로 ${added === undefined ? '' : `새로 ${added}개, `}모두 ${words.length}개 단어가 있어요. 틀린 글자가 있을 수 있으니 아래에서 확인해 주세요.` +
        (missing ? `<br>뜻을 못 찾은 단어 ${missing}개는 빨간 칸에 뜻을 적어 주세요.` : '')
    );
  };

  let busy = false;
  const run = async (button, task) => {
    if (!images.length || busy) return;
    busy = true;
    $ocr.disabled = true;
    if ($ai) $ai.disabled = true;
    try {
      await task();
    } catch (err) {
      note(esc(err.message), true);
    } finally {
      busy = false;
      $ocr.disabled = false;
      if ($ai) $ai.disabled = false;
    }
  };

  // 사진들을 한 장씩 읽는다 (from 번째부터). 사진 여러 장이면 "사진 2/4" 처럼 진행을 보여 준다.
  const readPhotos = async (from, readOne, label) => {
    const lists = [];
    for (let i = from; i < images.length; i++) {
      const prefix = images.length > 1 ? `사진 ${i + 1}/${images.length} · ` : '';
      status(loading(`${prefix}${label}...`));
      lists.push(
        await readOne(images[i], (pct, text) => {
          const el = $status.querySelector('.loading');
          if (el) el.lastChild.textContent = `${prefix}${pct === null ? `${text}...` : `${text}... ${pct}%`}`;
        })
      );
    }
    readCount = images.length;
    return lists;
  };
  const ocrOne = (image, onProgress) => recognizeWords(image, onProgress);
  const aiOne = async (image) => (await db.extractWords(image)).words;

  // 새로 올린 사진만 읽어서 지금 표에 이어 붙인다
  const readNew = () =>
    run($ocr, async () => {
      const before = currentWords();
      const lists = await readPhotos(readCount, ocrOne, '인식 준비 중');
      const words = mergePages([before, ...lists], edgeWords);
      for (const list of lists) for (const w of list.slice(0, EDGE_ROWS)) edgeWords.add(w.word.toLowerCase());
      showResult(words, '무료 인식', before.length ? words.length - before.length : undefined);
    });

  // 무료 인식 (브라우저 안에서 Tesseract.js) - 모든 사진을 처음부터 다시 읽어 표를 바꾼다
  $ocr.onclick = () => {
    if (currentWords().length && !confirm('모든 사진을 다시 읽어서 아래 표를 새로 채울까요?\n직접 고친 내용은 사라집니다.')) return;
    run($ocr, async () => {
      edgeWords.clear();
      const lists = await readPhotos(0, ocrOne, '인식 준비 중');
      showResult(mergePages([[], ...lists]), '무료 인식');
      for (const list of lists) for (const w of list.slice(0, EDGE_ROWS)) edgeWords.add(w.word.toLowerCase());
    });
  };

  // AI 인식 (Supabase Edge Function + Claude)
  if ($ai)
    $ai.onclick = () =>
      run($ai, async () => showResult(mergePages([[], ...(await readPhotos(0, aiOne, 'AI가 사진을 읽는 중 (10~30초)'))]), 'AI'));

  document.getElementById('save').onclick = async (e) => {
    const words = editor.get().filter((w) => w.word || w.meaning);
    if (editor.hasEmpty()) return toast('단어와 뜻을 모두 채워 주세요.');
    if (!words.length) return toast('단어를 1개 이상 입력해 주세요.');
    e.target.disabled = true;
    try {
      const { set } = await db.createSet({
        title: document.getElementById('title').value,
        images,
        words,
      });
      toast('단어장을 저장했어요!');
      go(`/set/${set.id}`);
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  };
}

async function viewEdit({ params: [id], isCurrent }) {
  const { set } = await db.getSet(id);
  if (!isCurrent()) return;
  $app.innerHTML = `
    ${topbar('단어장 수정', { back: `/set/${id}` })}
    <div class="card">
      <input type="text" id="title" value="${esc(set.title)}" maxlength="60" style="margin-bottom:12px">
      <div id="editor"></div>
    </div>
    <div class="row" style="margin-top:16px">
      <a class="btn" href="#/set/${id}">취소</a>
      <button class="btn primary" id="save" style="flex:1">저장</button>
    </div>`;
  const editor = mountEditor(document.getElementById('editor'), set.words);
  document.getElementById('save').onclick = async () => {
    if (editor.hasEmpty()) return toast('단어와 뜻을 모두 채워 주세요.');
    try {
      await db.updateSet(id, {
        title: document.getElementById('title').value,
        words: editor.get().filter((w) => w.word),
      });
      toast('저장했어요.');
      go(`/set/${id}`);
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- 단어장 상세 ----------

async function viewSet({ params: [id], query, isCurrent }) {
  const isParent = state.me.role === 'parent';
  const viewUser = isParent && query.user ? query.user : state.me.code;
  const isSelf = viewUser === state.me.code;
  const [{ set }, progress] = await Promise.all([
    db.getSet(id),
    db.getProgress(id, viewUser),
  ]);
  if (!isCurrent()) return;
  const { summary, attempts } = progress;
  const st = stepState(summary);

  const stepDesc = (key) => {
    if (key === 'learn') return summary.learnedAt ? `완료 · ${fmtDate(summary.learnedAt)}` : STEP_INFO.learn.desc;
    const s = summary[key];
    if (!s) return STEP_INFO[key].desc;
    let text = `최근 ${s.lastAccuracy}% · 최고 ${s.bestAccuracy}% · ${s.count}회`;
    if (key === 'final') text += summary.passed ? ' · 통과!' : ` · ${state.passRate}% 이상이면 통과`;
    return text;
  };

  const stepRow = (key) => {
    const info = STEP_INFO[key];
    const cls = st.done[key] ? 'done' : st.current === key ? 'current' : '';
    const href = key === 'learn' ? `#/set/${id}/learn` : `#/set/${id}/run/${key}`;
    const label = st.done[key] || summary[key] ? '다시' : '시작';
    return `
      <div class="card step ${cls}">
        <div class="num">${st.done[key] ? '✓' : info.no}</div>
        <div class="info">
          <div class="name">${info.name}</div>
          <div class="desc">${esc(stepDesc(key))}</div>
        </div>
        ${
          isSelf ? `<a class="btn small ${st.current === key ? 'primary' : ''}" href="${href}">${label}</a>` : ''
        }
      </div>`;
  };

  const stepName = (a) => STEP_INFO[a.step].name + (a.mode === 'retry' ? ' (틀린 것 다시)' : '');

  $app.innerHTML = `
    ${topbar(set.title, { back: query.user ? '/report' : '/' })}
    ${
      isParent
        ? `<div class="user-switch">
            <a class="btn small ${viewUser === '9585' ? 'primary' : ''}" href="#/set/${id}?user=9585">학생 기록</a>
            <a class="btn small ${viewUser === '5238' ? 'primary' : ''}" href="#/set/${id}?user=5238">내 기록</a>
          </div>`
        : ''
    }
    ${!isSelf ? `<div class="card small" style="margin-bottom:12px">👀 <b>${esc(progress.user.name)}</b>의 학습 기록을 보고 있어요.</div>` : ''}
    ${set.hasImage ? `<div class="thumbs" id="thumbs" style="margin-bottom:12px"></div>` : ''}
    <div class="section-title" style="margin-top:8px">학습 단계 <span class="small muted" style="font-weight:400">· 원하는 단계부터 해도 돼요</span></div>
    ${STEP_ORDER.map(stepRow).join('')}

    <div class="section-title">시험 기록</div>
    <div class="card history">
      ${
        attempts.length
          ? attempts
              .map(
                (a) => `
          <a href="#/set/${id}/result/${a.id}${isSelf ? '' : `?user=${viewUser}`}">
            <span><b>${esc(stepName(a))}</b><br><span class="small muted">${fmtDate(a.at)} · ${a.correct}/${a.total} 정답</span></span>
            <span class="row">
              ${a.step === 'final' && a.passed !== null ? `<span class="badge ${a.passed ? 'good' : 'bad'}">${a.passed ? '통과' : '미통과'}</span>` : ''}
              <b>${a.accuracy}%</b>
            </span>
          </a>`
              )
              .join('')
          : '<div class="empty small">아직 시험 기록이 없어요.</div>'
      }
    </div>

    <div class="section-title">단어 ${set.words.length}개</div>
    <div class="card">
      <ul class="word-list">
        ${set.words
          .map((w) => `<li><span class="w">${esc(w.word)}</span><span class="m">${esc(w.meaning)}</span></li>`)
          .join('')}
      </ul>
    </div>
    <div class="row" style="margin-top:16px">
      <a class="btn small" href="#/set/${id}/edit">✏️ 수정</a>
      <button class="btn small" id="csv">⬇️ CSV</button>
      ${isParent || set.createdBy === state.me.code ? '<button class="btn small danger" id="del">삭제</button>' : ''}
    </div>`;

  const $thumbs = document.getElementById('thumbs');
  if ($thumbs)
    db.imageUrls(id)
      .then((urls) => {
        if (!urls.length) return $thumbs.remove();
        $thumbs.classList.toggle('many', urls.length > 1);
        $thumbs.innerHTML = urls.map((u, i) => `<img class="thumb" src="${esc(u)}" alt="원본 사진 ${i + 1}">`).join('');
      })
      .catch(() => $thumbs.remove());
  document.getElementById('csv').onclick = () => db.downloadCsv(set);
  $thumbs?.addEventListener('click', (e) => {
    if (e.target.tagName !== 'IMG') return;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${esc(e.target.src)}" alt="원본 사진">`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  });
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm(`'${set.title}' 단어장을 삭제할까요?\n학생·부모의 학습 기록도 함께 삭제됩니다.`)) return;
    try {
      await db.deleteSet(id);
      toast('삭제했어요.');
      go('/');
    } catch (err) {
      toast(err.message);
    }
  });
}

// ---------- 1단계: 단어 암기 (플래시카드) ----------

async function viewLearn({ params: [id], isCurrent }) {
  const { set } = await db.getSet(id);
  if (!isCurrent()) return;
  const total = set.words.length;
  let queue = shuffle(set.words);
  let learned = 0;
  let flipped = false;

  const finish = async () => {
    await db.markLearned(id, total);
    if (!isCurrent()) return;
    $app.innerHTML = `
      ${topbar(set.title, { back: `/set/${id}` })}
      <div class="card score">
        <div style="font-size:56px">🎉</div>
        <div class="verdict">단어 ${total}개를 모두 외웠어요!</div>
        <p class="muted">이제 뜻 맞추기 테스트로 확인해 볼까요?</p>
      </div>
      <div class="runner-actions">
        <button class="btn" id="again">한 번 더 보기</button>
        <a class="btn primary" href="#/set/${id}/run/quiz">2단계 뜻 맞추기 →</a>
      </div>`;
    document.getElementById('again').onclick = () => render();
  };

  const draw = () => {
    const w = queue[0];
    flipped = false;
    $app.innerHTML = `
      <div class="runner-top">
        <a class="btn icon ghost" href="#/set/${id}" aria-label="그만하기">✕</a>
        <div class="progress"><div style="width:${(learned / total) * 100}%"></div></div>
        <span class="count">${learned}/${total}</span>
      </div>
      <div class="question"><div class="label">1단계 · 단어 암기 — 카드를 눌러 뜻을 확인하세요</div></div>
      <div class="flashcard" id="card">
        <div class="inner">
          <div class="face front">
            <div class="word">${esc(w.word)}</div>
            <button class="speak" id="say" aria-label="발음 듣기">🔊</button>
            <div class="hint">눌러서 뜻 보기</div>
          </div>
          <div class="face back">
            <div class="word" style="font-size:22px">${esc(w.word)}</div>
            <div class="meaning">${esc(w.meaning)}</div>
          </div>
        </div>
      </div>
      <div class="runner-actions">
        <button class="btn" id="again">🔁 한 번 더 볼래요</button>
        <button class="btn good" id="ok">✓ 외웠어요</button>
      </div>
      <p class="center small muted" style="margin-top:12px">'한 번 더'를 누르면 뒤에 다시 나와요</p>`;
    const $card = document.getElementById('card');
    const flip = () => {
      flipped = !flipped;
      $card.classList.toggle('flipped', flipped);
    };
    $card.onclick = (e) => {
      if (e.target.id === 'say') return;
      flip();
    };
    document.getElementById('say').onclick = () => speak(w.word);
    document.getElementById('again').onclick = () => {
      queue.push(queue.shift());
      draw();
    };
    document.getElementById('ok').onclick = () => {
      queue.shift();
      learned++;
      if (queue.length === 0) finish();
      else draw();
    };
    window.onkeydown = (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        flip();
      } else if (e.key === 'ArrowRight') document.getElementById('ok').click();
      else if (e.key === 'ArrowLeft') document.getElementById('again').click();
    };
    speak(w.word);
  };
  draw();
}

// ---------- 2·3·4단계: 시험 진행 ----------

function buildOptions(word, set, extraMeanings) {
  const pool = shuffle([
    ...new Set(set.words.filter((w) => w.id !== word.id && w.meaning !== word.meaning).map((w) => w.meaning)),
  ]);
  const extras = shuffle(extraMeanings.filter((m) => m !== word.meaning && !pool.includes(m)));
  const distractors = [...pool, ...extras].slice(0, 4);
  return shuffle([word.meaning, ...distractors]);
}

async function viewRun({ params: [id, step], query, isCurrent }) {
  const { set, extraMeanings } = await db.getSet(id);
  if (!isCurrent()) return;

  // 틀린 것만 다시: 이전 결과에서 틀린 단어만 출제
  let words = set.words;
  let mode = 'full';
  if (query.retry) {
    const { attempt } = await db.getAttempt(id, query.retry);
    if (!isCurrent()) return;
    const wrong = new Set(attempt.items.filter((i) => !i.correct).map((i) => i.wordId));
    words = set.words.filter((w) => wrong.has(w.id));
    mode = 'retry';
    if (!words.length) return go(`/set/${id}`);
  }

  // 최종 테스트는 뜻/스펠링 문제를 반반 섞는다.
  const TYPE_OF = { quiz: 'meaning', spell: 'spell', meaning_write: 'meaning_write', spell_write: 'spell_write' };
  const types = step === 'final'
    ? shuffle(words.map((_, i) => (i % 2 === 0 ? 'meaning' : 'spell')))
    : words.map(() => TYPE_OF[step]);
  const questions = shuffle(words).map((w, i) => ({
    word: w,
    type: types[i],
    options: types[i] === 'meaning' ? buildOptions(w, set, extraMeanings) : null,
  }));

  const answers = [];
  let idx = 0;
  const title = `${STEP_INFO[step].no}단계 · ${STEP_INFO[step].name}${mode === 'retry' ? ' (틀린 것 다시)' : ''}`;

  const header = () => `
    <div class="runner-top">
      <button class="btn icon ghost" id="quit" aria-label="그만하기">✕</button>
      <div class="progress"><div style="width:${(idx / questions.length) * 100}%"></div></div>
      <span class="count">${idx + 1}/${questions.length}</span>
    </div>`;

  const bindQuit = () => {
    document.getElementById('quit').onclick = () => {
      if (answers.length === 0 || confirm('그만할까요? 지금까지 푼 내용은 저장되지 않아요.')) go(`/set/${id}`);
    };
  };

  const next = () => {
    idx++;
    if (idx < questions.length) draw();
    else submit();
  };

  const submit = async () => {
    $app.innerHTML = loading('채점 중...');
    try {
      const { attempt } = await db.submitAttempt(id, { step, mode, answers });
      if (!isCurrent()) return;
      go(`/set/${id}/result/${attempt.id}`);
    } catch (err) {
      $app.innerHTML = `<div class="card empty">${esc(err.message)}<br><br><button class="btn" id="retry">다시 제출</button></div>`;
      document.getElementById('retry').onclick = submit;
    }
  };

  const drawMeaning = (q) => {
    $app.innerHTML = `
      ${header()}
      <div class="question">
        <div class="label">${esc(title)} — 알맞은 뜻을 고르세요</div>
        <div class="prompt">${esc(q.word.word)}</div>
        <button class="speak" id="say" aria-label="발음 듣기" style="margin-top:8px">🔊</button>
      </div>
      <div class="options">
        ${q.options.map((o, i) => `<button class="option" data-i="${i}"><span class="n">${i + 1}</span><span>${esc(o)}</span></button>`).join('')}
      </div>
      <div id="fb"></div>`;
    bindQuit();
    document.getElementById('say').onclick = () => speak(q.word.word);
    speak(q.word.word);
    const buttons = [...document.querySelectorAll('.option')];
    const choose = (i) => {
      if (buttons[0].disabled) return;
      const picked = q.options[i];
      const correct = picked === q.word.meaning;
      answers.push({ wordId: q.word.id, type: 'meaning', answer: picked });
      buttons.forEach((b, j) => {
        b.disabled = true;
        if (q.options[j] === q.word.meaning) b.classList.add('correct');
        else if (j === i) b.classList.add('wrong');
      });
      showFeedback(correct, `${q.word.word} = ${q.word.meaning}`);
    };
    buttons.forEach((b) => (b.onclick = () => choose(Number(b.dataset.i))));
    window.onkeydown = (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) choose(n - 1);
    };
  };

  const drawSpell = (q) => {
    const target = q.word.word;
    const letters = [...target].filter((c) => c !== ' ');
    let tiles = shuffle(letters.map((c, i) => ({ c, i })));
    // 원래 순서와 똑같이 섞이면 한 번 더 섞는다
    for (let t = 0; t < 5 && letters.length > 1 && tiles.every((x, k) => x.c === letters[k]); t++) tiles = shuffle(tiles);
    const picked = []; // tile index 목록

    const slotsHtml = (cls = "") => {
      let k = 0;
      return `<div class="slots ${cls}">${[...target]
        .map((c) => {
          if (c === ' ') return '<span class="gap"></span>';
          const tileIdx = picked[k];
          const html = `<span class="slot ${tileIdx !== undefined ? 'filled' : k === picked.length ? 'next' : ''}">${tileIdx !== undefined ? esc(tiles[tileIdx].c) : ''}</span>`;
          k++;
          return html;
        })
        .join('')}</div>`;
    };

    const drawInner = () => {
      document.getElementById('slots').innerHTML = slotsHtml();
      document.querySelectorAll('.tile').forEach((b) => b.classList.toggle('used', picked.includes(Number(b.dataset.i))));
    };

    $app.innerHTML = `
      ${header()}
      <div class="question">
        <div class="label">${esc(title)} — 뜻에 맞는 단어를 순서대로 눌러요</div>
        <div class="prompt ko">${esc(q.word.meaning)}</div>
      </div>
      <div id="slots"></div>
      <div class="tiles">
        ${tiles.map((t, i) => `<button class="tile" data-i="${i}">${esc(t.c)}</button>`).join('')}
      </div>
      <div class="row" style="justify-content:center">
        <button class="btn small" id="back">⌫ 지우기</button>
        <button class="btn small" id="reset">처음부터</button>
      </div>
      <div id="fb"></div>`;
    bindQuit();
    drawInner();

    const check = () => {
      const answer = (() => {
        let k = 0;
        return [...target].map((c) => (c === ' ' ? ' ' : tiles[picked[k++]].c)).join('');
      })();
      const correct = answer.toLowerCase() === target.toLowerCase();
      answers.push({ wordId: q.word.id, type: 'spell', answer });
      document.getElementById('slots').innerHTML = slotsHtml(correct ? 'correct' : 'wrong');
      document.querySelectorAll('.tile, #back, #reset').forEach((b) => (b.disabled = true));
      speak(target);
      showFeedback(correct, target);
    };
    const add = (i) => {
      if (picked.includes(i) || picked.length >= letters.length || answers.length > idx) return;
      picked.push(i);
      drawInner();
      if (picked.length === letters.length) check();
    };
    document.querySelectorAll('.tile').forEach((b) => (b.onclick = () => add(Number(b.dataset.i))));
    const back = () => {
      if (answers.length > idx) return;
      picked.pop();
      drawInner();
    };
    document.getElementById('back').onclick = back;
    document.getElementById('reset').onclick = () => {
      picked.length = 0;
      drawInner();
    };
    // 키보드로도 입력 가능 (PC)
    window.onkeydown = (e) => {
      if (e.key === 'Backspace') return back();
      if (e.key.length !== 1) return;
      const i = tiles.findIndex((t, j) => !picked.includes(j) && t.c.toLowerCase() === e.key.toLowerCase());
      if (i >= 0) add(i);
    };
  };

  const showFeedback = (correct, answerText) => {
    const fb = document.getElementById('fb');
    fb.innerHTML = `
      <div class="feedback ${correct ? 'good' : 'bad'}">
        ${correct ? '⭕ 정답이에요!' : '❌ 틀렸어요. 정답은'}
        ${correct ? '' : `<span class="answer">${esc(answerText)}</span>`}
      </div>
      <div class="runner-actions"><button class="btn primary" id="next">${idx + 1 < questions.length ? '다음 문제 →' : '결과 보기'}</button></div>`;
    const $next = document.getElementById('next');
    $next.onclick = next;
    $next.focus({ preventScroll: true });
    window.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // 4·5단계: 직접 쓰기 (키보드 또는 🎤 음성)
  const drawWrite = (q) => {
    const isSpell = q.type === 'spell_write';
    let stopListening = null;
    $app.innerHTML = `
      ${header()}
      <div class="question">
        <div class="label">${esc(title)} — ${isSpell ? '뜻에 맞는 영어 단어를 쓰세요' : '단어의 뜻을 한국어로 쓰세요'}</div>
        <div class="prompt ${isSpell ? 'ko' : ''}">${esc(isSpell ? q.word.meaning : q.word.word)}</div>
        ${isSpell ? '' : '<button class="speak" id="say" aria-label="발음 듣기" style="margin-top:8px">🔊</button>'}
      </div>
      <form class="write-box" id="writeForm" autocomplete="off">
        <div class="write-row">
          <input type="text" id="answer" lang="${isSpell ? 'en' : 'ko'}" enterkeyhint="done"
            placeholder="${isSpell ? '영어 단어' : '뜻 (여러 개 중 하나만 써도 돼요)'}"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
          ${voiceSupported ? `<button type="button" class="btn mic" id="mic" aria-label="말로 입력하기">🎤</button>` : ''}
        </div>
        <div class="small muted" id="voiceNote" style="min-height:20px;margin-top:6px">${
          voiceSupported ? '' : '이 브라우저는 🎤 음성 입력을 지원하지 않아요. 키보드의 마이크를 쓰거나, 크롬·사파리에서 열어 주세요.'
        }</div>
        <div class="runner-actions">
          <button type="button" class="btn" id="skip">모르겠어요</button>
          <button type="submit" class="btn primary" id="ok">확인</button>
        </div>
      </form>
      <div id="fb"></div>`;
    bindQuit();
    const $in = document.getElementById('answer');
    const $note = document.getElementById('voiceNote');
    if (!isSpell) {
      document.getElementById('say').onclick = () => speak(q.word.word);
      speak(q.word.word);
    }
    $in.focus();

    const finish = (answer) => {
      if (answers.length > idx) return;
      stopListening?.();
      const correct = isSpell
        ? answer.trim().replace(/\s+/g, ' ').toLowerCase() === q.word.word.trim().replace(/\s+/g, ' ').toLowerCase()
        : meaningMatches(answer, q.word.meaning);
      answers.push({ wordId: q.word.id, type: q.type, answer });
      $in.disabled = true;
      $in.classList.add(correct ? 'correct' : 'wrong');
      document.querySelectorAll('#writeForm button').forEach((b) => (b.disabled = true));
      if (isSpell) speak(q.word.word);
      showFeedback(correct, isSpell ? q.word.word : `${q.word.word} = ${q.word.meaning}`);
    };
    document.getElementById('writeForm').onsubmit = (e) => {
      e.preventDefault();
      if (!$in.value.trim()) return $in.focus();
      finish($in.value.trim());
    };
    document.getElementById('skip').onclick = () => finish('');

    const $mic = document.getElementById('mic');
    if ($mic)
      $mic.onclick = () => {
        if (stopListening) return stopListening();
        $mic.classList.add('on');
        $note.textContent = isSpell ? '듣고 있어요… 단어를 말하거나 한 글자씩 불러 주세요 (A, P, P, L, E)' : '듣고 있어요… 뜻을 말해 주세요';
        stopListening = listen({
          lang: isSpell ? 'en-US' : 'ko-KR',
          onText: (t) => ($in.value = isSpell ? toSpelling(t) : t),
          onEnd: (t) => {
            stopListening = null;
            $mic.classList.remove('on');
            if (t) {
              $in.value = isSpell ? toSpelling(t) : t;
              $note.textContent = '맞으면 확인을 누르세요. 고칠 게 있으면 직접 고쳐도 돼요.';
            } else if ($note.textContent.startsWith('듣고')) $note.textContent = '';
          },
          onError: (msg) => ($note.textContent = msg),
        });
      };
  };

  const draw = () => {
    window.onkeydown = null;
    const q = questions[idx];
    if (q.type === 'meaning') drawMeaning(q);
    else if (q.type === 'spell') drawSpell(q);
    else drawWrite(q);
  };
  draw();
}

// ---------- 결과 ----------

async function viewResult({ params: [id, attemptId], query, isCurrent }) {
  const userQs = query.user ? `?user=${query.user}` : '';
  const [{ set }, { attempt, user }] = await Promise.all([
    db.getSet(id),
    db.getAttempt(id, attemptId, query.user),
  ]);
  if (!isCurrent()) return;
  const isSelf = user.code === state.me.code;
  const wrong = attempt.items.filter((i) => !i.correct);
  const right = attempt.items.filter((i) => i.correct);
  const info = STEP_INFO[attempt.step];
  const pct = attempt.accuracy;
  const good = pct >= state.passRate;
  const color = good ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';

  let verdict;
  if (attempt.step === 'final' && attempt.passed !== null) verdict = attempt.passed ? '🏆 통과했어요!' : `아쉬워요, ${state.passRate}% 이상이면 통과예요`;
  else verdict = pct === 100 ? '💯 완벽해요!' : good ? '👍 잘했어요!' : '💪 조금만 더 연습해요';

  const nextStep = { quiz: 'spell', spell: 'meaning_write', meaning_write: 'spell_write', spell_write: 'final' }[attempt.step];
  const TYPE_LABEL = { meaning: '뜻 고르기', spell: '스펠링', meaning_write: '뜻 쓰기', spell_write: '스펠링 쓰기' };
  const item = (i) => `
    <li class="${i.correct ? 'ok' : 'ng'}">
      <span class="mark">${i.correct ? 'O' : 'X'}</span>
      <div class="body">
        <div class="w">${esc(i.word)} <span class="muted" style="font-weight:400">· ${esc(i.meaning)}</span></div>
        <div class="detail">
          ${TYPE_LABEL[i.type] || '뜻 고르기'}
          ${i.correct ? (i.type === 'meaning_write' ? ` · 쓴 답: ${esc(i.answer)}` : '') : i.answer ? ` · ${i.type?.endsWith('_write') ? '쓴' : '고른'} 답: <span class="yours">${esc(i.answer)}</span>` : ' · 모르겠어요'}
        </div>
      </div>
      <button class="speak" data-say="${esc(i.word)}" aria-label="발음 듣기" style="width:36px;height:36px;font-size:16px">🔊</button>
    </li>`;

  $app.innerHTML = `
    ${topbar(set.title, { back: `/set/${id}${userQs}` })}
    <div class="card score">
      <div class="small muted">${info.no}단계 · ${info.name}${attempt.mode === 'retry' ? ' (틀린 것 다시)' : ''} · ${fmtDate(attempt.at)}${isSelf ? '' : ` · ${esc(user.name)}`}</div>
      <div class="ring" style="--pct:${pct};--ring-color:${color};margin-top:12px">
        <div><span class="pct">${pct}%</span><span class="frac">${attempt.correct}/${attempt.total} 정답</span></div>
      </div>
      <div class="verdict">${verdict}</div>
    </div>
    ${
      isSelf
        ? `<div class="runner-actions" style="flex-wrap:wrap">
            ${wrong.length ? `<a class="btn primary" href="#/set/${id}/run/${attempt.step}?retry=${attempt.id}">틀린 ${wrong.length}개 다시</a>` : ''}
            <a class="btn" href="#/set/${id}/run/${attempt.step}">전체 다시</a>
            ${nextStep && attempt.mode === 'full' ? `<a class="btn ${wrong.length ? '' : 'primary'}" href="#/set/${id}/run/${nextStep}">${STEP_INFO[nextStep].no}단계 ${STEP_INFO[nextStep].name} →</a>` : ''}
          </div>`
        : ''
    }
    ${wrong.length ? `<div class="section-title">틀린 단어 (${wrong.length})</div><div class="card"><ul class="result-list">${wrong.map(item).join('')}</ul></div>` : ''}
    ${right.length ? `<div class="section-title">맞힌 단어 (${right.length})</div><div class="card"><ul class="result-list">${right.map(item).join('')}</ul></div>` : ''}
    <a class="btn block" href="#/set/${id}${userQs}" style="margin-top:16px">단어장으로</a>`;

  document.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => speak(b.dataset.say)));
}

// ---------- 시작 ----------

// 새 버전이 배포됐는데 휴대폰이 예전 화면을 캐시하고 있으면 한 번 새로 불러온다.
// (GitHub Pages 는 파일을 10분간 캐시한다. __V__ 는 배포할 때 커밋 번호로 바뀐다)
const APP_VERSION = '__V__';
async function checkNewVersion() {
  if (APP_VERSION.startsWith('__')) return; // 로컬 개발
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { v } = await res.json();
    if (!v || v === APP_VERSION) return;
    const key = `reloaded-${v}`;
    if (sessionStorage.getItem(key)) return; // 무한 새로고침 방지
    sessionStorage.setItem(key, '1');
    location.replace(`${location.pathname}?v=${v}${location.hash}`);
  } catch {
    /* 오프라인 등 - 무시 */
  }
}

(async () => {
  checkNewVersion();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkNewVersion());
  try {
    if (!db.configured) {
      $app.innerHTML = `<div class="card empty" style="margin-top:40px">⚙️ Supabase 설정이 필요합니다.<br><span class="small">web/js/config.js 에 SUPABASE_URL 과 SUPABASE_ANON_KEY 를 입력하세요.</span></div>`;
      return;
    }
    const me = await db.getMe();
    state.me = me.user;
    state.passRate = me.passRate;
  } catch {
    state.me = null;
  }
  db.onSignedOut(() => {
    state.me = null;
    go('/login');
  });
  window.addEventListener('hashchange', render);
  render();
  // 일부 브라우저는 음성 목록을 늦게 불러온다
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
})();
