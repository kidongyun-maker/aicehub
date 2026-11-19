// 단어 게임 2가지: 짝 맞추기 타임어택(뜻), 철자 블록 러시(스펠링)
// 최고 기록은 기기(브라우저)에 저장한다 — 시험 기록과 달리 서버에 남기지 않는다.

export const GAMES = {
  match: { name: '짝 맞추기 타임어택', icon: '🃏', desc: '영어와 뜻 카드의 짝을 빨리 찾아요' },
  spell: { name: '철자 블록 러시', icon: '🧱', desc: '60초 동안 철자를 최대한 많이 맞혀요' },
};

const MATCH_WORDS = 12; // 한 판에 나오는 단어 수 (6쌍씩 두 판)
const MATCH_BOARD = 6;
const MATCH_PENALTY = 1; // 틀리면 +1초
const SPELL_SECONDS = 60;
const DECOYS = 2; // 철자 블록에 섞는 가짜 글자 수

// ---------- 최고 기록 (localStorage, 실패해도 게임은 된다) ----------

const recKey = (code, setId, game) => `game:${code}:${setId}:${game}`;
export function getRecord(code, setId, game) {
  try {
    return JSON.parse(localStorage.getItem(recKey(code, setId, game)) || 'null');
  } catch {
    return null;
  }
}
function saveRecord(code, setId, game, rec) {
  try {
    localStorage.setItem(recKey(code, setId, game), JSON.stringify(rec));
  } catch {}
}

export function recordText(game, rec) {
  if (!rec) return GAMES[game].desc;
  return game === 'match' ? `최고 기록 ${rec.time.toFixed(1)}초 (${rec.count}개)` : `최고 점수 ${rec.score}점 · ${rec.words}단어`;
}

// ---------- 공통 ----------

const isLetter = (c) => /[A-Za-z]/.test(c);

function endScreen(ctx, { emoji, title, lines, isBest, missed, other }) {
  const { $app, esc, id, game } = ctx;
  $app.innerHTML = `
    <div class="card score game-end">
      <div style="font-size:56px">${emoji}</div>
      ${isBest ? '<div class="badge good" style="font-size:15px;padding:4px 12px">🏆 새 기록!</div>' : ''}
      <div class="verdict">${esc(title)}</div>
      ${lines.map((l) => `<p class="muted" style="margin:4px 0">${l}</p>`).join('')}
    </div>
    ${
      missed.length
        ? `<div class="section-title">헷갈린 단어</div>
           <div class="card"><ul class="word-list">${missed
             .map((w) => `<li><span class="w">${esc(w.word)}</span><span class="m">${esc(w.meaning)}</span></li>`)
             .join('')}</ul></div>`
        : ''
    }
    <div class="runner-actions" style="margin-top:16px">
      <button class="btn primary" id="again">한 판 더</button>
      <a class="btn" href="#/set/${id}/game/${other}">${GAMES[other].icon} ${GAMES[other].name}</a>
    </div>
    <a class="btn block" href="#/set/${id}" style="margin-top:12px">단어장으로</a>`;
  document.getElementById('again').onclick = () => ctx.restart(game);
}

// ---------- 1. 짝 맞추기 타임어택 ----------

export function playMatch(ctx) {
  const { $app, set, id, esc, shuffle, speak, isCurrent, code } = ctx;
  const words = shuffle(set.words).slice(0, MATCH_WORDS);
  const boards = [];
  for (let i = 0; i < words.length; i += MATCH_BOARD) boards.push(words.slice(i, i + MATCH_BOARD));
  // 마지막 판이 1~2쌍이면 너무 쉬워서 앞 판에 붙인다
  if (boards.length > 1 && boards.at(-1).length < 3) boards.at(-2).push(...boards.pop());

  let boardIdx = 0;
  let penalty = 0;
  let mistakes = 0;
  const missed = new Map();
  let start = 0;
  let timer = null;

  const elapsed = () => (performance.now() - start) / 1000 + penalty;
  const tick = () => {
    if (!isCurrent()) return clearInterval(timer);
    const el = document.getElementById('clock');
    if (el) el.textContent = elapsed().toFixed(1);
  };

  const drawBoard = () => {
    const pairs = boards[boardIdx];
    const left = shuffle(pairs);
    const right = shuffle(pairs);
    let selected = { en: null, ko: null };
    let remaining = pairs.length;

    $app.innerHTML = `
      <div class="runner-top">
        <a class="btn icon ghost" href="#/set/${id}" aria-label="그만하기">✕</a>
        <div class="progress"><div style="width:${(boardIdx / boards.length) * 100}%"></div></div>
        <span class="game-clock">⏱ <b id="clock">0.0</b>초</span>
      </div>
      <div class="question"><div class="label">${GAMES.match.icon} 짝 맞추기 · ${boardIdx + 1}/${boards.length}판 — 영어와 뜻을 하나씩 눌러요</div></div>
      <div class="match-board">
        <div class="match-col">${left.map((w) => `<button class="match-card en" data-id="${esc(w.id)}">${esc(w.word)}</button>`).join('')}</div>
        <div class="match-col">${right.map((w) => `<button class="match-card ko" data-id="${esc(w.id)}">${esc(w.meaning)}</button>`).join('')}</div>
      </div>
      <div class="center small muted" id="penalty" style="min-height:20px;margin-top:8px"></div>`;
    tick();

    const byId = Object.fromEntries(pairs.map((w) => [w.id, w]));
    const cards = [...document.querySelectorAll('.match-card')];
    const select = (btn) => {
      const side = btn.classList.contains('en') ? 'en' : 'ko';
      if (btn.classList.contains('gone')) return;
      selected[side]?.classList.remove('selected');
      if (selected[side] === btn) return (selected[side] = null);
      selected[side] = btn;
      btn.classList.add('selected');
      if (side === 'en') speak(byId[btn.dataset.id].word);
      if (!selected.en || !selected.ko) return;

      const en = byId[selected.en.dataset.id];
      const ko = byId[selected.ko.dataset.id];
      const { en: a, ko: b } = selected;
      selected = { en: null, ko: null };
      // 뜻이 같은 단어가 둘이면 어느 쪽과 짝지어도 정답
      if (en.id === ko.id || en.meaning === ko.meaning) {
        [a, b].forEach((x) => x.classList.replace('selected', 'gone'));
        if (--remaining === 0) setTimeout(nextBoard, 250);
      } else {
        penalty += MATCH_PENALTY;
        mistakes++;
        missed.set(en.id, en);
        [a, b].forEach((x) => {
          x.classList.remove('selected');
          x.classList.add('shake');
          setTimeout(() => x.classList.remove('shake'), 400);
        });
        const p = document.getElementById('penalty');
        p.textContent = `+${MATCH_PENALTY}초`;
        p.classList.remove('pop');
        void p.offsetWidth;
        p.classList.add('pop');
        tick();
      }
    };
    cards.forEach((b) => (b.onclick = () => select(b)));
  };

  const nextBoard = () => {
    if (!isCurrent()) return;
    boardIdx++;
    if (boardIdx < boards.length) return drawBoard();
    clearInterval(timer);
    const time = Math.round(elapsed() * 10) / 10;
    const prev = getRecord(code, set.id, 'match');
    // 단어 수가 다르면(단어장 수정 후) 새 기록으로 본다
    const isBest = !prev || prev.count !== words.length || time < prev.time;
    if (isBest) saveRecord(code, set.id, 'match', { time, count: words.length, at: Date.now() });
    endScreen(ctx, {
      emoji: mistakes === 0 ? '🌟' : '🎉',
      title: `${time.toFixed(1)}초 만에 ${words.length}쌍을 모두 찾았어요!`,
      lines: [
        mistakes ? `틀린 횟수 ${mistakes}번 (+${mistakes * MATCH_PENALTY}초)` : '한 번도 안 틀렸어요!',
        prev && !isBest ? `최고 기록 ${prev.time.toFixed(1)}초` : '',
      ].filter(Boolean),
      isBest: isBest && Boolean(prev),
      missed: [...missed.values()],
      other: 'spell',
    });
  };

  drawBoard();
  start = performance.now();
  timer = setInterval(tick, 100);
}

// ---------- 2. 철자 블록 러시 ----------

export function playSpell(ctx) {
  const { $app, set, id, esc, shuffle, speak, isCurrent, code } = ctx;
  let queue = shuffle(set.words);
  let score = 0;
  let combo = 0;
  let bestCombo = 0;
  let done = 0;
  const missed = new Map();
  const endAt = performance.now() + SPELL_SECONDS * 1000;
  let timer = null;
  let over = false;

  const remain = () => Math.max(0, (endAt - performance.now()) / 1000);

  $app.innerHTML = `
    <div class="runner-top">
      <a class="btn icon ghost" href="#/set/${id}" aria-label="그만하기">✕</a>
      <div class="progress time"><div id="timebar" style="width:100%"></div></div>
      <span class="game-clock">⏱ <b id="clock">${SPELL_SECONDS}</b></span>
    </div>
    <div class="game-stats">
      <span>점수 <b id="score">0</b></span>
      <span id="combo" class="combo"></span>
    </div>
    <div id="stage"></div>`;

  const tick = () => {
    if (!isCurrent()) return clearInterval(timer);
    const r = remain();
    document.getElementById('clock').textContent = Math.ceil(r);
    const bar = document.getElementById('timebar');
    bar.style.width = `${(r / SPELL_SECONDS) * 100}%`;
    bar.classList.toggle('low', r <= 10);
    if (r <= 0) finish();
  };

  const showStats = () => {
    document.getElementById('score').textContent = score;
    const c = document.getElementById('combo');
    c.textContent = combo >= 2 ? `🔥 ${combo}콤보` : '';
    c.classList.remove('pop');
    void c.offsetWidth;
    if (combo >= 2) c.classList.add('pop');
  };

  const nextWord = () => {
    if (over) return;
    if (!queue.length) queue = shuffle(set.words);
    drawWord(queue.shift());
  };

  const drawWord = (w) => {
    const target = [...w.word];
    const needed = target.filter(isLetter);
    // 가짜 글자: 단어에 없는 알파벳 중에서 (대소문자는 단어에 맞춰)
    const lower = w.word.toLowerCase();
    const pool = 'abcdefghijklmnopqrstuvwxyz'.split('').filter((c) => !lower.includes(c));
    const decoys = shuffle(pool).slice(0, Math.min(DECOYS, Math.max(1, Math.floor(needed.length / 3))));
    let tiles = shuffle([...needed, ...decoys].map((c, i) => ({ c, i })));
    for (let t = 0; t < 5 && tiles.length > 1 && tiles.every((x, k) => x.c === needed[k]); t++) tiles = shuffle(tiles);
    let pos = 0; // 다음에 채울 글자 (needed 기준)
    let clean = true; // 한 번도 안 틀렸는지

    document.getElementById('stage').innerHTML = `
      <div class="question">
        <div class="label">${GAMES.spell.icon} 뜻에 맞는 철자를 순서대로 눌러요</div>
        <div class="prompt ko">${esc(w.meaning)}</div>
        <button class="speak" id="say" aria-label="발음 듣기" style="margin-top:8px">🔊</button>
      </div>
      <div class="slots" id="slots"></div>
      <div class="tiles">${tiles.map((t, i) => `<button class="tile" data-i="${i}">${esc(t.c)}</button>`).join('')}</div>
      <div class="row" style="justify-content:center"><button class="btn small" id="pass">패스 →</button></div>`;

    const drawSlots = (cls = '') => {
      let k = 0;
      document.getElementById('slots').className = `slots ${cls}`;
      document.getElementById('slots').innerHTML = target
        .map((c) => {
          if (c === ' ') return '<span class="gap"></span>';
          if (!isLetter(c)) return `<span class="slot filled fixed">${esc(c)}</span>`;
          const html = k < pos ? `<span class="slot filled">${esc(needed[k])}</span>` : `<span class="slot ${k === pos ? 'next' : ''}"></span>`;
          k++;
          return html;
        })
        .join('');
    };
    drawSlots();
    document.getElementById('say').onclick = () => speak(w.word);

    const complete = (passed) => {
      window.onkeydown = null;
      document.querySelectorAll('.tile, #pass').forEach((b) => (b.disabled = true));
      if (passed) {
        pos = needed.length;
        combo = 0;
        missed.set(w.id, w);
        drawSlots('wrong');
      } else {
        done++;
        if (clean) combo++;
        else combo = 0;
        bestCombo = Math.max(bestCombo, combo);
        const gain = 10 + needed.length + Math.min(50, combo >= 2 ? (combo - 1) * 5 : 0); // 콤보 보너스는 최대 +50
        score += gain;
        drawSlots('correct');
        floatText(`+${gain}`);
      }
      showStats();
      speak(w.word);
      setTimeout(nextWord, passed ? 1200 : 600);
    };

    const press = (btn) => {
      if (over || !btn || btn.disabled || btn.classList.contains('used')) return;
      const t = tiles[Number(btn.dataset.i)];
      if (t.c.toLowerCase() === needed[pos].toLowerCase()) {
        btn.classList.add('used');
        pos++;
        drawSlots();
        if (pos === needed.length) complete(false);
      } else {
        clean = false;
        if (combo) {
          combo = 0;
          showStats();
        }
        missed.set(w.id, w);
        btn.classList.add('shake');
        setTimeout(() => btn.classList.remove('shake'), 400);
      }
    };
    document.querySelectorAll('.tile').forEach((b) => (b.onclick = () => press(b)));
    document.getElementById('pass').onclick = () => complete(true);
    // PC 키보드로도 칠 수 있게
    window.onkeydown = (e) => {
      if (e.key.length !== 1 || !isLetter(e.key)) return;
      const key = e.key.toLowerCase();
      press([...document.querySelectorAll('.tile:not(.used)')].find((b) => tiles[Number(b.dataset.i)].c.toLowerCase() === key));
    };
  };

  const floatText = (text) => {
    const el = document.createElement('div');
    el.className = 'float-score';
    el.textContent = text;
    document.getElementById('stage').appendChild(el);
    setTimeout(() => el.remove(), 900);
  };

  const finish = () => {
    if (over) return;
    over = true;
    clearInterval(timer);
    window.onkeydown = null;
    const prev = getRecord(code, set.id, 'spell');
    const isBest = score > 0 && (!prev || score > prev.score);
    if (isBest) saveRecord(code, set.id, 'spell', { score, words: done, combo: bestCombo, at: Date.now() });
    endScreen(ctx, {
      emoji: '⏰',
      title: `${score}점!`,
      lines: [
        `맞힌 단어 ${done}개 · 최고 콤보 ${bestCombo}`,
        prev && !isBest ? `최고 점수 ${prev.score}점` : '',
      ].filter(Boolean),
      isBest: isBest && Boolean(prev),
      missed: [...missed.values()],
      other: 'match',
    });
  };

  nextWord();
  timer = setInterval(tick, 200);
}
