// 단어 게임 2가지: 짝 맞추기 타임어택(뜻), 철자 블록 러시(스펠링)
// 게임 화면은 body.game-mode 로 앱과 다른 '게임' 디자인을 쓴다 (밤하늘 배경, 카드, 장난감 블록, 효과음).
// 최고 기록은 기기(브라우저)에 저장한다 — 시험 기록과 달리 서버에 남기지 않는다.

export const GAMES = {
  match: { name: '짝 맞추기 타임어택', short: '짝 맞추기', icon: '🃏', desc: '영어와 뜻 카드의 짝을 빨리 찾아요' },
  spell: { name: '철자 블록 러시', short: '철자 블록', icon: '🧱', desc: '60초 동안 철자를 최대한 많이 맞혀요' },
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
  return game === 'match' ? `최고 기록 ${rec.time.toFixed(1)}초 (${rec.count}개)` : `최고 점수 ${rec.score}점 · ${rec.words}단어`;
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

function endScreen(ctx, { medal, title, stars, stats, isBest, missed, other }) {
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
      <div class="g-row">
        <a class="g-btn" href="#/set/${id}/game/${other}">${GAMES[other].icon} ${GAMES[other].short}</a>
        <a class="g-btn" href="#/set/${id}">단어장으로</a>
      </div>
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
      other: 'spell',
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
      other: 'match',
    });
  };

  nextWord();
  countdown(isCurrent, () => {
    endAt = performance.now() + SPELL_SECONDS * 1000;
    timer = setInterval(tick, 200);
  });
}
