// 단어 게임 4가지: 짝 맞추기 타임어택(뜻), 철자 블록 러시(스펠링), 단어 유성 막기(스펠링 직접 쓰기), 보스 배틀(전체 복습)
// 게임 화면은 body.game-mode 로 앱과 다른 '게임' 디자인을 쓴다 (밤하늘 배경, 카드, 장난감 블록, 효과음).
// 최고 기록은 기기(브라우저)에 저장한다 — 시험 기록과 달리 서버에 남기지 않는다.

export const GAMES = {
  match: { name: '짝 맞추기 타임어택', short: '짝 맞추기', icon: '🃏', desc: '영어와 뜻 카드의 짝을 빨리 찾아요' },
  spell: { name: '철자 블록 러시', short: '철자 블록', icon: '🧱', desc: '60초 동안 철자를 최대한 많이 맞혀요' },
  rain: { name: '단어 유성 막기', short: '유성 막기', icon: '☄️', desc: '떨어지는 뜻을 보고 영어 단어를 쳐서 막아요' },
  boss: { name: '보스 배틀', short: '보스 배틀', icon: '⚔️', desc: '단어장 전체로 보스를 물리쳐요' },
};

const MATCH_WORDS = 12; // 한 게임에 나오는 단어 수 (6쌍씩 두 라운드)
const MATCH_BOARD = 6;
const MATCH_PENALTY = 1; // 틀리면 +1초
const SPELL_SECONDS = 60;
const DECOYS = 2; // 철자 블록에 섞는 가짜 글자 수
// 블록 색 (앞색, 아랫면 그림자색)
const BRICKS = [['#ff5a5f', '#c23238'], ['#ff9f1c', '#c46f00'], ['#ffd23f', '#c9a000'], ['#2ec4b6', '#178f84'], ['#3a86ff', '#1f5bc4'], ['#9b5de5', '#6a35ad'], ['#f15bb5', '#b8357f']];

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
  if (game === 'match') return `최고 기록 ${rec.time.toFixed(1)}초 (${rec.count}개)`;
  if (game === 'rain') return `최고 점수 ${rec.score}점 · 레벨 ${rec.level}`;
  if (game === 'boss') return rec.won ? `🏆 격파! 실수 ${rec.mistakes}번` : `최고 ${rec.pct}% 공격`;
  return `최고 점수 ${rec.score}점 · ${rec.words}단어`;
}

// ---------- 효과음 (Web Audio로 직접 만든 짧은 소리, 파일 없음) ----------

let audio = null;
let muted = (() => {
  try {
    return localStorage.getItem('game:mute') === '1';
  } catch {
    return false;
  }
})();

const TONES = {
  tap: [[880, 0.05, 'sine']],
  good: [[660, 0.07, 'triangle'], [990, 0.1, 'triangle']],
  bad: [[160, 0.18, 'square']],
  clear: [[523, 0.08, 'triangle'], [659, 0.08, 'triangle'], [784, 0.08, 'triangle'], [1047, 0.16, 'triangle']],
  combo: [[784, 0.06, 'square'], [1047, 0.06, 'square'], [1319, 0.12, 'square']],
  count: [[440, 0.12, 'sine']],
  go: [[880, 0.25, 'sine']],
  tick: [[1200, 0.03, 'sine']],
  end: [[523, 0.12, 'triangle'], [659, 0.12, 'triangle'], [784, 0.12, 'triangle'], [1047, 0.3, 'triangle']],
};
function sfx(kind) {
  if (muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    let t = audio.currentTime;
    for (const [freq, dur, type] of TONES[kind]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(type === 'square' ? 0.06 : 0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.9;
    }
  } catch {}
}

// ---------- 공통 화면 조각 ----------

const isLetter = (c) => /[A-Za-z]/.test(c);

function hud(id, center, right) {
  return `
    <div class="g-hud">
      <a class="g-round" href="#/set/${id}" aria-label="그만하기">✕</a>
      <div class="g-hud-center">${center}</div>
      ${right}
      <button class="g-round" id="mute" aria-label="효과음 켜기/끄기">${muted ? '🔇' : '🔊'}</button>
    </div>`;
}
function bindMute() {
  const b = document.getElementById('mute');
  b.onclick = () => {
    muted = !muted;
    try {
      localStorage.setItem('game:mute', muted ? '1' : '0');
    } catch {}
    b.textContent = muted ? '🔇' : '🔊';
    sfx('tap');
  };
}

// 3, 2, 1, 시작! 이 끝나면 onDone
function countdown(isCurrent, onDone) {
  const el = document.createElement('div');
  el.className = 'g-countdown';
  document.body.appendChild(el);
  const steps = ['3', '2', '1', '시작!'];
  let i = 0;
  const show = () => {
    if (!isCurrent()) return el.remove();
    if (i === steps.length) {
      el.remove();
      return onDone();
    }
    el.innerHTML = `<span>${steps[i]}</span>`;
    sfx(i === steps.length - 1 ? 'go' : 'count');
    i++;
    setTimeout(show, i === steps.length ? 500 : 650);
  };
  show();
}

// 가운데에 잠깐 뜨는 큰 글씨 (라운드 2, 콤보 등)
function banner(text, cls = '') {
  const el = document.createElement('div');
  el.className = `g-banner ${cls}`;
  el.innerHTML = `<span>${text}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

// 요소 위치에서 반짝이 터뜨리기
function sparkle(target, color = '#ffd23f', n = 10) {
  const r = target.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'g-spark';
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const d = 30 + Math.random() * 40;
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${color};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

// 위로 떠오르는 글씨 (+15, +1초)
function floatAt(target, text, cls = '') {
  const r = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `g-float ${cls}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function confetti() {
  const colors = BRICKS.map((b) => b[0]);
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('span');
    p.className = 'g-confetti';
    p.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % colors.length]};--r:${Math.random() * 720 - 360}deg;--dx:${Math.random() * 120 - 60}px;animation-delay:${Math.random() * 0.6}s;animation-duration:${1.8 + Math.random() * 1.4}s`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 4000);
  }
}

function endScreen(ctx, { medal, title, stars, stats, isBest, missed }) {
  const { $app, esc, id, game } = ctx;
  $app.innerHTML = `
    <div class="g-end">
      <div class="g-panel g-result">
        ${isBest ? '<div class="g-ribbon">🏆 새 기록!</div>' : ''}
        <div class="g-medal">${medal}</div>
        <div class="g-stars">${[1, 2, 3].map((n) => `<span class="${n <= stars ? 'on' : ''}" style="--d:${n * 0.15}s">★</span>`).join('')}</div>
        <div class="g-title">${esc(title)}</div>
        <div class="g-stats">${stats.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      </div>
      ${
        missed.length
          ? `<div class="g-panel">
               <div class="g-sub">💡 헷갈린 단어</div>
               <ul class="g-missed">${missed
                 .map((w) => `<li><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></li>`)
                 .join('')}</ul>
             </div>`
          : ''
      }
      <button class="g-btn primary" id="again">▶ 한 판 더</button>
      <div class="g-row g-others">
        ${Object.keys(GAMES)
          .filter((k) => k !== game)
          .map((k) => `<a class="g-btn small" href="#/set/${id}/game/${k}"><span>${GAMES[k].icon}</span>${GAMES[k].short}</a>`)
          .join('')}
      </div>
      <a class="g-btn" href="#/set/${id}">단어장으로</a>
    </div>`;
  sfx('end');
  if (isBest || stars === 3) setTimeout(confetti, 300);
  document.getElementById('again').onclick = () => ctx.restart(game);
}

// ---------- 1. 짝 맞추기 타임어택 ----------

export function playMatch(ctx) {
  const { $app, set, id, esc, shuffle, speak, isCurrent, code } = ctx;
  const words = shuffle(set.words).slice(0, MATCH_WORDS);
  const boards = [];
  for (let i = 0; i < words.length; i += MATCH_BOARD) boards.push(words.slice(i, i + MATCH_BOARD));
  // 마지막 라운드가 1~2쌍이면 너무 쉬워서 앞 라운드에 붙인다
  if (boards.length > 1 && boards.at(-1).length < 3) boards.at(-2).push(...boards.pop());

  let boardIdx = 0;
  let penalty = 0;
  let mistakes = 0;
  const missed = new Map();
  let start = 0;
  let timer = null;
  let started = false;

  const elapsed = () => (started ? (performance.now() - start) / 1000 + penalty : 0);
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
      ${hud(
        id,
        `<div class="g-label">${GAMES.match.icon} 라운드 ${boardIdx + 1}/${boards.length}</div>
         <div class="g-pips">${boards.map((_, i) => `<i class="${i < boardIdx ? 'done' : i === boardIdx ? 'now' : ''}"></i>`).join('')}</div>`,
        `<div class="g-timer" id="timerBox">⏱ <b id="clock">${elapsed().toFixed(1)}</b></div>`
      )}
      <div class="g-hint">영어 카드와 뜻 카드를 하나씩 눌러 짝을 맞춰요</div>
      <div class="g-board">
        <div class="g-col">${left.map((w, i) => `<button class="g-card en" style="--d:${i * 0.06}s" data-id="${esc(w.id)}"><span>${esc(w.word)}</span></button>`).join('')}</div>
        <div class="g-col">${right.map((w, i) => `<button class="g-card ko" style="--d:${0.03 + i * 0.06}s" data-id="${esc(w.id)}"><span>${esc(w.meaning)}</span></button>`).join('')}</div>
      </div>`;
    bindMute();
    tick();

    const byId = Object.fromEntries(pairs.map((w) => [w.id, w]));
    const select = (btn) => {
      if (!started || btn.classList.contains('matched')) return; // 사라지는 중인 카드는 다시 못 누른다
      const side = btn.classList.contains('en') ? 'en' : 'ko';
      selected[side]?.classList.remove('selected');
      if (selected[side] === btn) return (selected[side] = null);
      selected[side] = btn;
      btn.classList.add('selected');
      sfx('tap');
      if (side === 'en') speak(byId[btn.dataset.id].word);
      if (!selected.en || !selected.ko) return;

      const en = byId[selected.en.dataset.id];
      const ko = byId[selected.ko.dataset.id];
      const { en: a, ko: b } = selected;
      selected = { en: null, ko: null };
      // 뜻이 같은 단어가 둘이면 어느 쪽과 짝지어도 정답
      if (en.id === ko.id || en.meaning === ko.meaning) {
        sfx('good');
        [a, b].forEach((x) => {
          x.classList.replace('selected', 'matched');
          sparkle(x, '#7bffb0');
          setTimeout(() => x.classList.add('gone'), 260);
        });
        if (--remaining === 0) setTimeout(nextBoard, 550);
      } else {
        sfx('bad');
        penalty += MATCH_PENALTY;
        mistakes++;
        missed.set(en.id, en);
        [a, b].forEach((x) => {
          x.classList.remove('selected');
          x.classList.add('wrong');
          setTimeout(() => x.classList.remove('wrong'), 450);
        });
        floatAt(document.getElementById('timerBox'), `+${MATCH_PENALTY}초`, 'bad');
        tick();
      }
    };
    document.querySelectorAll('.g-card').forEach((b) => (b.onclick = () => select(b)));
  };

  const nextBoard = () => {
    if (!isCurrent()) return;
    boardIdx++;
    if (boardIdx < boards.length) {
      sfx('clear');
      banner(`라운드 ${boardIdx + 1}`);
      return drawBoard();
    }
    clearInterval(timer);
    const time = Math.round(elapsed() * 10) / 10;
    const prev = getRecord(code, set.id, 'match');
    // 단어 수가 다르면(단어장 수정 후) 새 기록으로 본다
    const isBest = !prev || prev.count !== words.length || time < prev.time;
    if (isBest) saveRecord(code, set.id, 'match', { time, count: words.length, at: Date.now() });
    endScreen(ctx, {
      medal: mistakes === 0 ? '🥇' : mistakes <= 2 ? '🥈' : '🥉',
      stars: mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1,
      title: mistakes === 0 ? '완벽해요! 한 번도 안 틀렸어요' : `${words.length}쌍을 모두 찾았어요!`,
      stats: [
        ['기록', `${time.toFixed(1)}초`],
        ['틀린 횟수', `${mistakes}번`],
        ['최고 기록', `${(isBest ? time : prev.time).toFixed(1)}초`],
      ],
      isBest: isBest && Boolean(prev),
      missed: [...missed.values()],
    });
  };

  drawBoard();
  countdown(isCurrent, () => {
    started = true;
    start = performance.now();
    timer = setInterval(tick, 100);
  });
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
  let endAt = 0;
  let timer = null;
  let over = false;
  let lastSec = SPELL_SECONDS;

  const remain = () => (endAt ? Math.max(0, (endAt - performance.now()) / 1000) : SPELL_SECONDS);

  $app.innerHTML = `
    ${hud(
      id,
      `<div class="g-energy"><div id="timebar"></div></div>`,
      `<div class="g-timer" id="timerBox">⏱ <b id="clock">${SPELL_SECONDS}</b></div>`
    )}
    <div class="g-scorebar">
      <div class="g-score"><span>SCORE</span><b id="score">0</b></div>
      <div id="combo" class="g-combo"></div>
    </div>
    <div id="stage"></div>`;
  bindMute();

  const tick = () => {
    if (!isCurrent()) return clearInterval(timer);
    const r = remain();
    const sec = Math.ceil(r);
    document.getElementById('clock').textContent = sec;
    const bar = document.getElementById('timebar');
    bar.style.width = `${(r / SPELL_SECONDS) * 100}%`;
    const low = r <= 10;
    bar.classList.toggle('low', low);
    document.getElementById('timerBox').classList.toggle('low', low);
    if (low && sec !== lastSec && sec > 0) sfx('tick');
    lastSec = sec;
    if (r <= 0) finish();
  };

  const showStats = () => {
    document.getElementById('score').textContent = score;
    const c = document.getElementById('combo');
    c.innerHTML = combo >= 2 ? `🔥 <b>${combo}</b> 콤보` : '';
    c.classList.remove('pop');
    void c.offsetWidth;
    if (combo >= 2) c.classList.add('pop');
  };

  const nextWord = () => {
    if (over || !isCurrent()) return;
    if (!queue.length) queue = shuffle(set.words);
    drawWord(queue.shift());
  };

  const drawWord = (w) => {
    const target = [...w.word];
    const needed = target.filter(isLetter);
    // 가짜 글자: 단어에 없는 알파벳 중에서
    const lower = w.word.toLowerCase();
    const pool = 'abcdefghijklmnopqrstuvwxyz'.split('').filter((c) => !lower.includes(c));
    const decoys = shuffle(pool).slice(0, Math.min(DECOYS, Math.max(1, Math.floor(needed.length / 3))));
    let tiles = shuffle([...needed, ...decoys].map((c, i) => ({ c, i })));
    for (let t = 0; t < 5 && tiles.length > 1 && tiles.every((x, k) => x.c === needed[k]); t++) tiles = shuffle(tiles);
    let pos = 0; // 다음에 채울 글자 (needed 기준)
    let clean = true; // 한 번도 안 틀렸는지
    const colorOf = []; // 채운 칸의 블록 색

    document.getElementById('stage').innerHTML = `
      <div class="g-panel g-question">
        <div class="g-label">${GAMES.spell.icon} 뜻에 맞는 철자를 순서대로!</div>
        <div class="g-meaning">${esc(w.meaning)}</div>
        <button class="g-round g-say" id="say" aria-label="발음 듣기">🔈</button>
      </div>
      <div class="g-slots" id="slots"></div>
      <div class="g-bricks">${tiles
        .map((t, i) => {
          const [c1, c2] = BRICKS[i % BRICKS.length];
          return `<button class="g-brick" data-i="${i}" style="--c:${c1};--c2:${c2};--d:${i * 0.04}s">${esc(t.c)}</button>`;
        })
        .join('')}</div>
      <div class="g-row center"><button class="g-btn small" id="pass">패스 ⏭</button></div>`;

    const drawSlots = (cls = '') => {
      let k = 0;
      const $s = document.getElementById('slots');
      $s.className = `g-slots ${cls}`;
      $s.style.setProperty('--n', target.length); // 긴 단어도 한 줄에 들어가게 칸 크기를 줄인다
      $s.innerHTML = target
        .map((c) => {
          if (c === ' ') return '<span class="gap"></span>';
          if (!isLetter(c)) return `<span class="g-slot fixed">${esc(c)}</span>`;
          const i = k++;
          if (i < pos) {
            const [c1, c2] = colorOf[i] || ['#8a8fa8', '#5d6278'];
            return `<span class="g-slot filled ${i === pos - 1 && !cls ? 'drop' : ''}" style="--c:${c1};--c2:${c2};--w:${i * 0.05}s">${esc(needed[i])}</span>`;
          }
          return `<span class="g-slot ${i === pos ? 'next' : ''}"></span>`;
        })
        .join('');
    };
    drawSlots();
    document.getElementById('say').onclick = () => speak(w.word);

    const complete = (passed) => {
      window.onkeydown = null;
      document.querySelectorAll('.g-brick, #pass').forEach((b) => (b.disabled = true));
      const $slots = document.getElementById('slots');
      if (passed) {
        pos = needed.length;
        combo = 0;
        missed.set(w.id, w);
        sfx('bad');
        drawSlots('wrong');
      } else {
        done++;
        if (clean) combo++;
        else combo = 0;
        bestCombo = Math.max(bestCombo, combo);
        const gain = 10 + needed.length + Math.min(50, combo >= 2 ? (combo - 1) * 5 : 0); // 콤보 보너스는 최대 +50
        score += gain;
        drawSlots('correct');
        sparkle($slots, '#ffd23f', 14);
        floatAt($slots, `+${gain}`, 'good');
        if (combo >= 3 && combo % 3 === 0) {
          sfx('combo');
          banner(`🔥 ${combo} 콤보!`, 'combo');
        } else sfx('clear');
      }
      showStats();
      speak(w.word);
      setTimeout(nextWord, passed ? 1300 : 750);
    };

    const press = (btn) => {
      if (over || !endAt || !btn || btn.disabled || btn.classList.contains('used')) return;
      const t = tiles[Number(btn.dataset.i)];
      if (t.c.toLowerCase() === needed[pos].toLowerCase()) {
        colorOf[pos] = BRICKS[Number(btn.dataset.i) % BRICKS.length];
        btn.classList.add('used');
        pos++;
        drawSlots();
        if (pos === needed.length) complete(false);
        else sfx('tap');
      } else {
        sfx('bad');
        clean = false;
        if (combo) {
          combo = 0;
          showStats();
        }
        missed.set(w.id, w);
        btn.classList.add('wrong');
        setTimeout(() => btn.classList.remove('wrong'), 450);
      }
    };
    document.querySelectorAll('.g-brick').forEach((b) => (b.onclick = () => press(b)));
    document.getElementById('pass').onclick = () => endAt && complete(true);
    // PC 키보드로도 칠 수 있게
    window.onkeydown = (e) => {
      if (e.key.length !== 1 || !isLetter(e.key)) return;
      const key = e.key.toLowerCase();
      press([...document.querySelectorAll('.g-brick:not(.used)')].find((b) => tiles[Number(b.dataset.i)].c.toLowerCase() === key));
    };
  };

  const finish = () => {
    if (over) return;
    over = true;
    clearInterval(timer);
    window.onkeydown = null;
    const prev = getRecord(code, set.id, 'spell');
    const isBest = score > 0 && (!prev || score > prev.score);
    if (isBest) saveRecord(code, set.id, 'spell', { score, words: done, combo: bestCombo, at: Date.now() });
    const stars = done >= 12 ? 3 : done >= 6 ? 2 : done >= 1 ? 1 : 0;
    endScreen(ctx, {
      medal: stars === 3 ? '🥇' : stars === 2 ? '🥈' : '🥉',
      stars,
      title: `시간 끝! ${score}점`,
      stats: [
        ['맞힌 단어', `${done}개`],
        ['최고 콤보', bestCombo],
        ['최고 점수', isBest ? score : prev?.score ?? 0],
      ],
      isBest: isBest && Boolean(prev),
      missed: [...missed.values()],
    });
  };

  nextWord();
  countdown(isCurrent, () => {
    endAt = performance.now() + SPELL_SECONDS * 1000;
    timer = setInterval(tick, 200);
  });
}

// 하트 표시 (남은 목숨)
const heartsHtml = (n, max) =>
  Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}">${i < n ? '❤' : '♡'}</i>`).join('');
const norm = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// ---------- 3. 단어 유성 막기 ----------
// 뜻이 적힌 유성이 떨어진다. 영어 단어를 쳐서 맞히면 레이저로 터뜨린다. 땅에 닿으면 하트 -1.
// 절반쯤 내려오면 첫 글자 힌트가 나온다 (힌트 보고 맞히면 점수 절반).

const RAIN_LIVES = 3;
const RAIN_LEVEL_EVERY = 6; // 6개 맞힐 때마다 레벨 업
const RAIN_LANES = [17, 50, 83]; // 유성이 떨어지는 세로줄 (가로 %)
const METEORS = [['#ff9f1c', '#ff5a5f'], ['#7b91ff', '#9b5de5'], ['#2ec4b6', '#3a86ff'], ['#f15bb5', '#9b5de5'], ['#ffd23f', '#ff9f1c']];

export function playRain(ctx) {
  const { $app, set, id, esc, shuffle, speak, isCurrent, code } = ctx;
  let queue = shuffle(set.words);
  let lives = RAIN_LIVES;
  let score = 0;
  let combo = 0;
  let bestCombo = 0;
  let hits = 0;
  let level = 1;
  let spawned = 0;
  const missed = new Map();
  const drops = []; // { w, el, lane, y, h, hinted }
  let running = false;
  let over = false;
  let last = 0;
  let spawnIn = 0;
  let fieldH = 400;
  const GROUND = 58;

  const fallSeconds = () => Math.max(4.2, 11 * Math.pow(0.91, level - 1)); // 위에서 땅까지 걸리는 시간
  const spawnGap = () => Math.max(1.2, 3.1 - (level - 1) * 0.25);
  const maxDrops = () => Math.min(set.words.length, 2 + Math.floor(level / 2), 5);

  $app.innerHTML = `
    ${hud(
      id,
      `<div class="g-label">${GAMES.rain.icon} 레벨 <b class="r-lv" id="lv">1</b></div>
       <div class="g-lives" id="lives">${heartsHtml(lives, RAIN_LIVES)}</div>`,
      ''
    )}
    <div class="g-scorebar">
      <div class="g-score"><span>SCORE</span><b id="score">0</b></div>
      <div id="combo" class="g-combo"></div>
    </div>
    <div class="r-field" id="field">
      <div class="r-stars"></div>
      <div class="r-ground"><div class="r-city"></div></div>
      <div class="r-cannon" id="cannon"><i></i></div>
    </div>
    <form class="r-input" id="form" autocomplete="off">
      <input id="typed" type="text" lang="en" enterkeyhint="send" placeholder="영어 단어를 쳐서 막아요"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <button class="r-fire" type="submit" aria-label="발사">🚀</button>
    </form>`;
  bindMute();
  const $field = document.getElementById('field');
  const $in = document.getElementById('typed');
  const $cannon = document.getElementById('cannon');

  // 화면 높이에 맞춰 하늘 크기 조절 (휴대폰 키보드가 올라와도 입력칸이 보이게)
  const fit = () => {
    if (!isCurrent()) return window.visualViewport?.removeEventListener('resize', fit);
    const vh = window.visualViewport?.height || window.innerHeight;
    const h = Math.round(Math.min(560, Math.max(230, vh - 250)));
    if (h === fieldH) return;
    drops.forEach((d) => (d.y *= h / fieldH));
    fieldH = h;
    $field.style.height = `${h}px`;
  };
  fieldH = 0;
  fit();
  window.visualViewport?.addEventListener('resize', fit);

  const showStats = () => {
    document.getElementById('score').textContent = score;
    document.getElementById('lives').innerHTML = heartsHtml(lives, RAIN_LIVES);
    document.getElementById('lv').textContent = level;
    const c = document.getElementById('combo');
    c.innerHTML = combo >= 2 ? `🔥 <b>${combo}</b> 콤보` : '';
    c.classList.remove('pop');
    void c.offsetWidth;
    if (combo >= 2) c.classList.add('pop');
  };

  // 첫 글자만 보여 준다: farewell party → f_______ p____ (단어 사이에서만 줄바꿈)
  const hintOf = (word) =>
    word
      .trim()
      .split(/\s+/)
      .map((part) => [...part].map((c, i) => (i === 0 || !isLetter(c) ? c : '_')).join(''))
      .join(' ');

  const spawn = () => {
    // 빈 줄 고르기: 막 떨어지기 시작한 유성이 있는 줄은 피한다
    const free = RAIN_LANES.map((_, i) => i).filter((i) => !drops.some((d) => d.lane === i && d.y < 110));
    if (!free.length) return false;
    // 지금 떨어지는 것과 같은 단어는 고르지 않는다
    if (!queue.length) queue = shuffle(set.words);
    const k = queue.findIndex((w) => !drops.some((d) => norm(d.w.word) === norm(w.word)));
    if (k < 0) return false;
    const [w] = queue.splice(k, 1);
    const lane = free[Math.floor(Math.random() * free.length)];
    const [c1, c2] = METEORS[spawned++ % METEORS.length];
    const el = document.createElement('div');
    el.className = 'r-drop';
    el.style.cssText = `left:${RAIN_LANES[lane]}%;--c1:${c1};--c2:${c2}`;
    el.innerHTML = `<div class="r-tail"></div><div class="r-rock"><span class="r-mean">${esc(w.meaning)}</span><span class="r-hint"></span></div>`;
    $field.appendChild(el);
    const d = { w, el, lane, y: -el.offsetHeight, h: el.offsetHeight, hinted: false };
    el.style.transform = `translate(-50%, ${d.y}px)`;
    drops.push(d);
    return true;
  };

  const removeDrop = (d) => {
    const i = drops.indexOf(d);
    if (i >= 0) drops.splice(i, 1);
  };

  const laser = (d) => {
    const f = $field.getBoundingClientRect();
    const c = $cannon.getBoundingClientRect();
    const t = d.el.querySelector('.r-rock').getBoundingClientRect();
    const x1 = c.left + c.width / 2 - f.left;
    const y1 = c.top + 6 - f.top;
    const x2 = t.left + t.width / 2 - f.left;
    const y2 = t.top + t.height / 2 - f.top;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const el = document.createElement('div');
    el.className = 'r-laser';
    el.style.cssText = `left:${x1}px;top:${y1}px;width:${Math.hypot(x2 - x1, y2 - y1)}px;transform:rotate(${ang}rad)`;
    $field.appendChild(el);
    setTimeout(() => el.remove(), 260);
    $cannon.style.setProperty('--a', `${ang + Math.PI / 2}rad`);
  };

  const fire = (d) => {
    removeDrop(d);
    laser(d);
    hits++;
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    const letters = [...d.w.word].filter(isLetter).length;
    let gain = 10 + letters + Math.min(40, combo >= 2 ? (combo - 1) * 4 : 0);
    if (d.hinted) gain = Math.round(gain / 2);
    score += gain;
    d.el.classList.add('boom');
    d.el.querySelector('.r-mean').textContent = d.w.word;
    sparkle(d.el.querySelector('.r-rock'), d.el.style.getPropertyValue('--c1'), 14);
    floatAt(d.el.querySelector('.r-rock'), `+${gain}`, 'good');
    setTimeout(() => d.el.remove(), 420);
    speak(d.w.word);
    const newLevel = 1 + Math.floor(hits / RAIN_LEVEL_EVERY);
    if (newLevel > level) {
      level = newLevel;
      sfx('combo');
      banner(`🚀 레벨 ${level}!`);
    } else if (combo >= 5 && combo % 5 === 0) {
      sfx('combo');
      banner(`🔥 ${combo} 콤보!`, 'combo');
    } else sfx('good');
    showStats();
  };

  const crash = (d) => {
    removeDrop(d);
    lives--;
    combo = 0;
    missed.set(d.w.id, d.w);
    d.el.classList.add('crash');
    d.el.style.transform = `translate(-50%, ${fieldH - GROUND - d.h + 10}px)`;
    d.el.querySelector('.r-hint').textContent = '';
    d.el.querySelector('.r-mean').innerHTML = `${esc(d.w.meaning)}<b>${esc(d.w.word)}</b>`;
    setTimeout(() => d.el.remove(), 1400);
    sfx('bad');
    $field.classList.remove('shake');
    void $field.offsetWidth;
    $field.classList.add('shake');
    showStats();
    if (lives <= 0) {
      running = false;
      setTimeout(finish, 1300);
    }
  };

  const frame = (t) => {
    if (!isCurrent() || !running) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    spawnIn -= dt;
    if (spawnIn <= 0 && drops.length < maxDrops() && spawn()) spawnIn = spawnGap();
    const ground = fieldH - GROUND;
    const v = (ground + 40) / fallSeconds();
    for (const d of [...drops]) {
      d.y += v * dt;
      if (!d.hinted && d.y + d.h > ground * 0.55) {
        d.hinted = true;
        d.el.querySelector('.r-hint').textContent = hintOf(d.w.word);
        d.el.classList.add('hinted');
      }
      if (d.y + d.h >= ground) crash(d);
      else d.el.style.transform = `translate(-50%, ${d.y}px)`;
    }
    requestAnimationFrame(frame);
  };

  // 치는 동안 정답이 되면 바로 발사 (엔터 안 눌러도 됨). 여러 개면 가장 아래 것부터.
  const tryFire = () => {
    const v = norm($in.value);
    if (!v || !running) return false;
    const d = drops.filter((x) => norm(x.w.word) === v).sort((a, b) => b.y - a.y)[0];
    if (!d) return false;
    fire(d);
    $in.value = '';
    return true;
  };
  $in.oninput = tryFire;
  document.getElementById('form').onsubmit = (e) => {
    e.preventDefault();
    if (!running || !$in.value.trim() || tryFire()) return;
    // 떨어지는 단어 중에 없음
    sfx('bad');
    if (combo) {
      combo = 0;
      showStats();
    }
    $in.classList.remove('wrong');
    void $in.offsetWidth;
    $in.classList.add('wrong');
    $in.select();
  };

  const finish = () => {
    if (over || !isCurrent()) return;
    over = true;
    running = false;
    window.visualViewport?.removeEventListener('resize', fit);
    const prev = getRecord(code, set.id, 'rain');
    const isBest = score > 0 && (!prev || score > prev.score);
    if (isBest) saveRecord(code, set.id, 'rain', { score, hits, level, at: Date.now() });
    const stars = hits >= 20 ? 3 : hits >= 10 ? 2 : hits >= 1 ? 1 : 0;
    endScreen(ctx, {
      medal: stars === 3 ? '🥇' : stars === 2 ? '🥈' : stars === 1 ? '🥉' : '💫',
      stars,
      title: hits ? `☄️ 유성을 ${hits}개 막았어요!` : '아쉬워요! 다시 도전해 봐요',
      stats: [
        ['점수', score],
        ['도달 레벨', level],
        ['최고 점수', isBest ? score : prev?.score ?? 0],
      ],
      isBest: isBest && Boolean(prev),
      missed: [...missed.values()],
    });
  };

  countdown(isCurrent, () => {
    running = true;
    last = performance.now();
    spawnIn = 0;
    $in.focus();
    requestAnimationFrame(frame);
  });
}

// ---------- 4. 보스 배틀 ----------
// 단어장 전체가 보스 체력. 맞히면 공격(체력 -1), 틀리면 보스의 반격(하트 -1)으로 그 단어는 조금 뒤에 다시 나온다.
// 체력이 줄면 보스가 변신한다. 5콤보마다 하트 회복.

const BOSS_HEARTS = 5;
const BOSS_FORMS = [
  { emoji: '👾', name: '꼬마 단어 몬스터', c1: '#9b5de5', c2: '#3a22a8' },
  { emoji: '👹', name: '성난 단어 도깨비', c1: '#ff7b2e', c2: '#a3201f' },
  { emoji: '🐉', name: '전설의 단어 드래곤', c1: '#2ec4b6', c2: '#0b4d6b' },
];
const OPT_COLORS = [['#8a6cff', '#5b3df5', '#3a22a8'], ['#ff9f43', '#ff7b2e', '#b8501a'], ['#2ec4b6', '#169e92', '#0d6b62'], ['#f15bb5', '#d63d93', '#8f1f5e']];

export function playBoss(ctx) {
  const { $app, set, id, esc, shuffle, speak, isCurrent, code } = ctx;
  const total = set.words.length;
  let queue = shuffle(set.words); // 남은 단어 = 보스 체력
  let hearts = BOSS_HEARTS;
  let combo = 0;
  let bestCombo = 0;
  let mistakes = 0;
  let form = 0;
  let busy = true;
  let over = false;
  const missed = new Map();

  const formOf = () => {
    const r = queue.length / total;
    return r > 2 / 3 ? 0 : r > 1 / 3 ? 1 : 2;
  };

  $app.innerHTML = `
    ${hud(id, `<div class="g-label">${GAMES.boss.icon} 보스 배틀</div><div class="g-lives" id="hearts"></div>`, '')}
    <div class="b-arena" id="arena">
      <div class="b-top">
        <div class="b-name" id="bname"></div>
        <div class="b-hp"><div class="b-hp-lag" id="hplag"></div><div class="b-hp-fill" id="hpfill"></div><span id="hptext"></span></div>
      </div>
      <div class="b-boss" id="boss">
        <div class="b-aura"></div>
        <div class="b-shadow"></div>
        <div class="b-emoji" id="bemoji"></div>
      </div>
      <div class="b-combo g-combo" id="combo"></div>
    </div>
    <div id="stage"></div>`;
  bindMute();
  const $arena = document.getElementById('arena');
  const $boss = document.getElementById('boss');

  const showBoss = () => {
    const f = BOSS_FORMS[form];
    $arena.style.setProperty('--b1', f.c1);
    $arena.style.setProperty('--b2', f.c2);
    document.getElementById('bemoji').textContent = f.emoji;
    document.getElementById('bname').textContent = f.name;
  };
  const showStats = () => {
    const pct = (queue.length / total) * 100;
    document.getElementById('hpfill').style.width = `${pct}%`;
    setTimeout(() => {
      const lag = document.getElementById('hplag');
      if (lag) lag.style.width = `${pct}%`;
    }, 350);
    document.getElementById('hptext').textContent = `${queue.length} / ${total}`;
    document.getElementById('hearts').innerHTML = heartsHtml(hearts, BOSS_HEARTS);
    const c = document.getElementById('combo');
    c.innerHTML = combo >= 2 ? `🔥 <b>${combo}</b> 콤보` : '';
    c.classList.remove('pop');
    void c.offsetWidth;
    if (combo >= 2) c.classList.add('pop');
  };
  const replay = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  // 보기 4개 (단어장에 단어가 적으면 그만큼만)
  const optionsFor = (w, key) => {
    const others = shuffle([...new Set(set.words.map((x) => x[key]).filter((v) => v !== w[key]))]).slice(0, 3);
    return shuffle([w[key], ...others]);
  };

  const drawTurn = () => {
    if (over || !isCurrent()) return;
    const w = queue[0];
    // 뜻 고르기와 영어 고르기를 섞는다
    const type = Math.random() < 0.5 ? 'meaning' : 'word';
    const key = type === 'meaning' ? 'meaning' : 'word';
    const opts = optionsFor(w, key);
    document.getElementById('stage').innerHTML = `
      <div class="g-panel b-q">
        <div class="g-label">${type === 'meaning' ? '이 단어의 뜻은?' : '이 뜻의 영어 단어는?'}</div>
        <div class="b-prompt ${type === 'meaning' ? 'en' : ''}">${esc(type === 'meaning' ? w.word : w.meaning)}</div>
        ${type === 'meaning' ? '<button class="g-round g-say" id="say" aria-label="발음 듣기">🔈</button>' : ''}
      </div>
      <div class="b-opts">
        ${opts
          .map((o, i) => {
            const [a, b, c] = OPT_COLORS[i % OPT_COLORS.length];
            return `<button class="b-opt ${type === 'word' ? 'en' : ''}" data-i="${i}" style="--o1:${a};--o2:${b};--o3:${c};--d:${i * 0.05}s"><span class="n">${i + 1}</span><span>${esc(o)}</span></button>`;
          })
          .join('')}
      </div>
      <div class="b-msg" id="msg"></div>`;
    if (type === 'meaning') {
      document.getElementById('say').onclick = () => speak(w.word);
      speak(w.word);
    }
    const buttons = [...document.querySelectorAll('.b-opt')];
    const choose = (i) => {
      if (busy || over) return;
      busy = true;
      window.onkeydown = null;
      const ok = opts[i] === w[key];
      buttons.forEach((b, j) => {
        b.disabled = true;
        if (opts[j] === w[key]) b.classList.add('correct');
        else if (j === i) b.classList.add('wrong');
      });
      if (type === 'word') speak(w.word);
      (ok ? attack : hurt)(w, buttons[i]);
    };
    buttons.forEach((b) => (b.onclick = () => choose(Number(b.dataset.i))));
    window.onkeydown = (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= opts.length) choose(n - 1);
    };
    busy = false;
  };

  // 정답: 보기에서 보스로 빛 구슬이 날아가 명중
  const attack = (w, btn) => {
    queue.shift();
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    sfx('good');
    const from = btn.getBoundingClientRect();
    const to = document.getElementById('bemoji').getBoundingClientRect();
    const shot = document.createElement('div');
    shot.className = 'b-shot';
    shot.style.cssText = `left:${from.left + from.width / 2}px;top:${from.top + from.height / 2}px;--dx:${to.left + to.width / 2 - (from.left + from.width / 2)}px;--dy:${to.top + to.height / 2 - (from.top + from.height / 2)}px`;
    document.body.appendChild(shot);
    setTimeout(() => {
      shot.remove();
      if (!isCurrent()) return;
      replay($boss, 'hit');
      sparkle(document.getElementById('bemoji'), '#ffd23f', 16);
      floatAt(document.getElementById('bemoji'), combo >= 3 ? `💥 ${combo}콤보!` : '-1', 'good');
      showStats();
      let delay = 650;
      if (queue.length === 0) return setTimeout(() => finish(true), 700);
      const nf = formOf();
      if (nf !== form) {
        form = nf;
        replay($boss, 'transform');
        setTimeout(showBoss, 300);
        sfx('combo');
        banner(`${BOSS_FORMS[form].emoji} 보스가 변신했어요!`);
        delay = 1300;
      } else if (combo % 5 === 0 && hearts < BOSS_HEARTS) {
        hearts++;
        sfx('clear');
        banner('💖 하트 회복!', 'combo');
        showStats();
        delay = 1000;
      }
      setTimeout(drawTurn, delay);
    }, 380);
  };

  // 오답: 보스의 반격. 틀린 단어는 조금 뒤에 다시 나온다
  const hurt = (w) => {
    hearts--;
    combo = 0;
    mistakes++;
    missed.set(w.id, w);
    queue.shift();
    queue.splice(Math.min(queue.length, 2 + Math.floor(Math.random() * 3)), 0, w);
    sfx('bad');
    replay($boss, 'lunge');
    setTimeout(() => {
      if (!isCurrent()) return;
      replay(document.body, 'b-flash');
      showStats();
    }, 220);
    document.getElementById('msg').innerHTML = `<b>${esc(w.word)}</b> = ${esc(w.meaning)}<span>이 단어는 보스가 다시 들고 나와요!</span>`;
    if (hearts <= 0) return setTimeout(() => finish(false), 1600);
    setTimeout(drawTurn, 1800);
  };

  const finish = (won) => {
    if (over || !isCurrent()) return;
    over = true;
    window.onkeydown = null;
    document.body.classList.remove('b-flash');
    const pct = Math.round(((total - queue.length) / total) * 100);
    const prev = getRecord(code, set.id, 'boss');
    const better =
      !prev || prev.count !== total
        ? true
        : won && !prev.won
          ? true
          : won && prev.won
            ? mistakes < prev.mistakes
            : !won && !prev.won && pct > prev.pct;
    if (better) saveRecord(code, set.id, 'boss', { won, pct, mistakes, count: total, at: Date.now() });
    const stars = won ? (mistakes === 0 ? 3 : mistakes <= 3 ? 2 : 1) : 0;
    endScreen(ctx, {
      medal: won ? '🏆' : '💫',
      stars,
      title: won ? `${BOSS_FORMS[form].name} 격파!` : `아쉬워요! 보스 체력이 ${queue.length}칸 남았어요`,
      stats: [
        ['공격', `${pct}%`],
        ['틀린 횟수', `${mistakes}번`],
        ['최고 콤보', bestCombo],
      ],
      isBest: better && Boolean(prev) && (won || pct > 0),
      missed: [...missed.values()],
    });
  };

  showBoss();
  showStats();
  drawTurn();
  busy = true;
  countdown(isCurrent, () => (busy = false));
}
