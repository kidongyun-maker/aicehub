// 스펠링 확인: 영어 단어 목록(data/words.txt)에 없는 단어를 찾아 비슷한 단어를 추천한다.
// 단어 목록: SCOWL (wordlist-english, 많이 쓰는 순서 10~70 단계) + word-list (Sindre Sorhus, MIT) — 둘 다 무료 라이선스
// 파일 형식: "#10" 같은 줄 다음부터 그 단계의 단어들. 숫자가 작을수록 자주 쓰는 단어 (#90 = 드문 단어)
const DICT_URL = 'data/words.txt?d=1'; // 단어 목록을 바꾸면 d 숫자를 올린다 (배포마다 새로 받지 않게)

let dict = null; // Map<단어, 단계>
let loading = null;

export function loadDict() {
  if (dict) return Promise.resolve(dict);
  loading ||= fetch(DICT_URL)
    .then((r) => {
      if (!r.ok) throw new Error('단어 목록을 불러오지 못했어요.');
      return r.text();
    })
    .then((text) => {
      const m = new Map();
      let tier = 90;
      for (const line of text.split('\n')) {
        if (!line) continue;
        if (line[0] === '#') tier = Number(line.slice(1));
        else m.set(line, tier);
      }
      for (const w of EXTRA) m.set(w, 10);
      dict = m;
      return m;
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export const dictReady = () => Boolean(dict);

// 목록에 없지만 단어장에 자주 나오는 것들
const EXTRA = (
  'a i ok tv pc cd dvd tv internet email wifi app apps online website sb sth sb\'s someone somebody something oneself ' +
  'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august ' +
  'september october november december korea korean english america american china chinese japan japanese'
).split(' ');

// 검사하지 않는 토큰: 약어(전부 대문자), 숫자, 단어장 표기(sb, sth, one's)
function skipToken(t) {
  return /^[A-Z]{2,}$/.test(t) || /\d/.test(t) || /^(sb|sth|one|one's|someone's)$/i.test(t);
}

function known(t) {
  const w = t.toLowerCase();
  // 축약형·소유격: don't, children's, it's → 앞부분만 확인
  return dict.has(w) || (/['’]/.test(w) && dict.has(w.split(/['’]/)[0]));
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
function edits1(w) {
  const out = new Set();
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (b) out.add(a + b.slice(1)); // 빠뜨림
    if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2)); // 순서 바뀜
    for (const c of LETTERS) {
      if (b) out.add(a + c + b.slice(1)); // 다른 글자
      out.add(a + c + b); // 덧붙임
    }
  }
  out.delete(w);
  return out;
}

// 사진 인식이 자주 헷갈리는 글자 (rn↔m, cl↔d, vv↔w, li↔h ...)
const OCR_SWAPS = [['rn', 'm'], ['cl', 'd'], ['vv', 'w'], ['li', 'h'], ['ii', 'u'], ['nn', 'm'], ['0', 'o'], ['1', 'l'], ['5', 's']];

// 비슷한 단어 1개 { word, score } (없으면 null). 많이 쓰는 단어일수록 점수가 낮다(좋다).
function suggestToken(t) {
  const w = t.toLowerCase();
  const tierOf = (x) => dict.get(x) ?? 999;
  let best = null, bestScore = Infinity;
  const consider = (x, penalty) => {
    const tier = dict.get(x);
    if (tier === undefined) return;
    const score = tier + penalty;
    if (score < bestScore) (best = x), (bestScore = score);
  };
  for (const [a, b] of OCR_SWAPS) {
    if (w.includes(a)) consider(w.split(a).join(b), 0);
    if (w.includes(b)) consider(w.split(b).join(a), 5);
  }
  const e1 = edits1(w);
  // 똑같이 흔한 단어면, 글자 수가 같은 쪽(한 글자를 잘못 읽은 경우)을 고른다: witn → with (win 아님)
  for (const x of e1) consider(x, x.length === w.length ? 0 : 1);
  if (best && bestScore <= 70) return { word: best, score: bestScore };
  // 두 글자 차이: 길이 4 이상, 많이 쓰는 단어(50단계까지)만
  if (w.length >= 4) {
    for (const x of e1) for (const y of edits1(x)) if (tierOf(y) <= 50) consider(y, 30);
  }
  return best && { word: best, score: bestScore };
}

/**
 * 단어(또는 숙어) 검사. 사전이 아직 없으면 null.
 * 반환: { ok: true } 또는 { ok: false, bad: ['witn'], suggestion: 'look after' | null }
 */
export function checkWord(text) {
  if (!dict) return null;
  const s = (text || '').trim();
  if (!s || /[가-힣]/.test(s)) return { ok: true };
  const parts = s.split(/([\s\-~/()]+)/); // 구분자도 남겨서 추천할 때 그대로 다시 붙인다
  const bad = [];
  let changed = false;
  const fixed = parts.map((p, i) => {
    if (i % 2 === 1 || !p) return p;
    const t = p.replace(/^['’.]+|['’.,!?]+$/g, '');
    if (!t || !/^[A-Za-z'’]+$/.test(t) || skipToken(t) || known(t)) return p;
    const sug = suggestToken(t);
    // 대문자로 시작하면 고유명사일 수 있어서, 아주 비슷한 흔한 단어가 있을 때만 알려 준다 (Recieve → Receive)
    if (/^[A-Z]/.test(t) && !(sug && sug.score <= 50)) return p;
    bad.push(t);
    if (!sug) return p;
    changed = true;
    const word = /^[A-Z]/.test(t) ? sug.word[0].toUpperCase() + sug.word.slice(1) : sug.word;
    return p.replace(t, word);
  });
  if (!bad.length) return { ok: true };
  return { ok: false, bad, suggestion: changed ? fixed.join('') : null };
}
