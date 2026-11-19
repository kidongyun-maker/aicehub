// 무료 사진 인식 (Tesseract.js, 브라우저 안에서 실행 - 서버/API 키 불필요)
// 처음 한 번 영어·한글 인식 데이터(약 4.5MB)를 내려받고, 이후에는 브라우저 캐시를 쓴다.
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;
let progressHandler = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('인식 프로그램을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    document.head.appendChild(s);
  });
}

function getWorker() {
  workerPromise ??= (async () => {
    await loadScript(TESSERACT_URL);
    const worker = await window.Tesseract.createWorker(['eng', 'kor'], 1, {
      logger: (m) => progressHandler?.(m),
    });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

// 인식 전처리
// 휴대폰 사진은 그림자·조명 차이 때문에 한 기준으로 흑백을 나누면 글자가 사라진다.
// 그래서 주변 밝기와 비교해 흑백을 나눈다(적응형 이진화, Bradley 방식).
const OCR_SIZE = 2400; // 긴 변 기준 (작으면 키우고, 크면 줄인다)

async function preprocess(dataUrl, binarize) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  if (!binarize) {
    // 깨끗한 스캔/캡처: 흑백 + 대비만 (원래 크기)
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.4)';
    g.drawImage(img, 0, 0);
    return c;
  }
  const scale = OCR_SIZE / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const px = ctx.getImageData(0, 0, w, h);
  const d = px.data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

  // 적분 영상으로 주변 평균 밝기를 빠르게 구한다 (최대 255×2400×3200 < 2^32)
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + x - 1];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.max(w, h) / 50)); // 창 반지름 (글자보다 넉넉히)
  const T = 0.15; // 주변보다 15% 이상 어두우면 글자
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x] < mean * (1 - T) ? 0 : 255;
      const k = (y * w + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = v;
    }
  }
  removeLines(d, w, h);
  ctx.putImageData(px, 0, 0);
  return canvas;
}

// 표의 칸 선(길게 이어진 검은 줄)을 지운다. 선이 남아 있으면 글자로 잘못 읽어 줄 전체가 망가진다.
// 사진이 조금 기울어도 잡히도록, 짧은 조각(글자 크기보다 긴 것)이 거의 일직선으로 이어지면 선으로 본다.
function removeLines(d, w, h) {
  const black = (x, y) => d[(y * w + x) * 4] === 0;
  const minRun = Math.round(Math.max(w, h) / 25); // 이보다 길게 이어진 검은 줄 = 선
  const mark = new Uint8Array(w * h);
  // 가로 선: 한 행에서 검은 점이 길게 이어지는 구간 (위아래 1px 흔들림 허용)
  for (let y = 1; y < h - 1; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && (black(x, y) || black(x, y - 1) || black(x, y + 1));
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minRun) for (let i = start; i < x; i++) mark[y * w + i] = 1;
        start = -1;
      }
    }
  }
  // 세로 선
  for (let x = 1; x < w - 1; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && (black(x, y) || black(x - 1, y) || black(x + 1, y));
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minRun) for (let i = start; i < y; i++) mark[i * w + x] = 1;
        start = -1;
      }
    }
  }
  for (let i = 0; i < mark.length; i++) if (mark[i]) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
}

/**
 * 사진에서 단어/뜻을 인식한다.
 * onProgress(percent, label) 로 진행 상황을 알려 준다.
 */
export async function recognizeWords(dataUrl, onProgress = () => {}) {
  let pass = '글자 인식 중';
  progressHandler = (m) => {
    if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100), pass);
    else if (/loading|initializ/i.test(m.status)) onProgress(null, '인식 준비 중 (처음 한 번은 데이터 다운로드)');
  };
  try {
    const worker = await getWorker();
    const read = async (image, psm) => {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      return parseWords((await worker.recognize(image)).data.text);
    };
    const complete = (r) => r.length > 0 && r.every((w) => w.meaning);
    // 1차: 흑백 사진을 한 줄씩(psm 4) - 깨끗한 스캔·캡처에 가장 정확하다
    let result = await read(await preprocess(dataUrl, false), '4');
    // 2차: 그림자·조명을 보정하고 표 선을 지운 사진으로 다시 읽기 (휴대폰 사진에 강하다)
    pass = '그림자 보정 후 다시 읽는 중';
    const clean = await preprocess(dataUrl, true);
    result = mergeResults(result, await read(clean, '4'));
    if (complete(result)) return result;
    // 3차: 한 덩어리로 읽기(psm 6) - 표를 행 단위로 읽어 단어-뜻 짝이 잘 맞는다
    pass = '표 형식으로 한 번 더 읽는 중';
    return mergeResults(result, await read(clean, '6'));
  } finally {
    progressHandler = null;
  }
}

// 두 번 읽은 결과를 합친다. 지금 결과(cur)를 기본으로 두고,
// 새 결과(next)가 단어-뜻 짝을 확실히 더 많이 찾았을 때만 기준을 바꾼다 (한두 개 차이는 잡음일 수 있음).
function mergeResults(cur, next) {
  const filled = (list) => list.filter((w) => w.meaning).length;
  const [base, other] = filled(next) >= filled(cur) * 1.25 + 1 ? [next, cur] : [cur, next];
  const byWord = new Map(other.map((w) => [w.word.toLowerCase(), w]));
  const merged = base.map((w) => (w.meaning ? w : { ...w, meaning: byWord.get(w.word.toLowerCase())?.meaning || '' }));
  if (merged.every((w) => w.meaning)) return merged; // 기준이 완전하면 다른 쪽 단어는 더하지 않는다
  // 기준 쪽이 놓친 단어 중, 다른 쪽에서 뜻까지 찾은 것만 넣는다 (잡음 단어 방지).
  // 기준 쪽에 잡음이 붙어 뜻 없이 남은 같은 단어("ancient Doel")가 있으면 그 자리를 바꾼다.
  // 같은 뜻이 이미 있으면 잘린 단어 조각("knowledge"→"ledge")이므로 넣지 않는다.
  const seen = new Set(merged.map((w) => w.word.toLowerCase()));
  const meanings = new Set(merged.map((w) => w.meaning).filter(Boolean));
  for (const w of other) {
    const key = w.word.toLowerCase();
    if (!w.meaning || seen.has(key) || meanings.has(w.meaning)) continue;
    const i = merged.findIndex((m) => !m.meaning && m.word.toLowerCase().startsWith(key + ' '));
    if (i >= 0) merged[i] = w;
    else merged.push(w);
    seen.add(key);
  }
  // 뜻도 없는 한 글자 잡음(I, a ...) 제거
  return merged.filter((w) => w.meaning || w.word.length > 1);
}

// ---------- 인식된 글자 → 단어/뜻 목록 ----------

const HANGUL = /[가-힣]/;
const POS_EN = /\b(n|v|vt|vi|adj|adv|a|ad|prep|conj|pron|int|phr)\.?\s*$/i;
const POS_KO = /^(?:\(?\[?(?:명|동|형|부|전|접|대|감|숙)\]?\)?\.?\s+)+/;

function cleanWord(w) {
  return w
    .replace(/[|_`~]/g, ' ')
    .replace(POS_EN, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-'.\s]+|[-'.\s]+$/g, '')
    .trim();
}

function cleanMeaning(m) {
  return m
    .replace(/\[[^\]]*\]/g, ' ') // 발음기호 [ ]
    .replace(/[|_`]/g, ' ')
    .replace(POS_KO, '')
    .replace(/[A-Za-z]{3,}.*$/, '') // 뒤에 붙은 다음 영어 문장/예문 제거
    .replace(/\s+\d+\s*$/, '') // 뒤에 붙은 다음 칸 번호
    .replace(/\s+/g, ' ')
    .replace(/^[\s:=\-–.,·)\d]+(?=[가-힣~])|^[\s:=\-–.,·)]+|[\s:=\-–,·(]+$/g, '')
    .trim();
}

// 한 줄을 [영어 덩어리, 한글 덩어리, ...] 순서로 나눈다.
const SEGMENT = /([A-Za-z][A-Za-z'’\- ]*[A-Za-z]|[A-Za-z])|([가-힣][가-힣0-9\s,~()·./;-]*)/g;
// 단어장 제목 줄 (Lesson 3, Unit 5, Day 1 Words ...)
const HEADER = /^(lesson|unit|day|chapter|part|week|test|quiz|review|vocabulary|words?|word list)\b/i;

function validWord(w) {
  if (w.length < 2 && !/^[aI]$/.test(w)) return false;
  if (/^[A-Z]{2,4}$/.test(w)) return false; // 한글을 잘못 읽은 대문자 잡음 (EEC, RYH ...)
  if (w.split(' ').length > 4) return false; // 영어 문장(예문)
  return !HEADER.test(w);
}

export function parseWords(text) {
  const out = [];
  // 영어만 있는 줄들을 모아 두었다가, 뒤이어 나오는 한글만 있는 줄과 순서대로 짝짓는다.
  // (word↵뜻↵ 처럼 번갈아 나오는 경우와, 표를 열 단위로 읽어 영어 열 → 한글 열 순서로 나오는 경우 모두 처리)
  const pending = [];
  let pairedFrom = -1; // pending 중 짝을 찾기 시작한 위치
  const flush = () => {
    for (const p of pending) out.push(p);
    pending.length = 0;
    pairedFrom = -1;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/\[[^\]]*\]|\/[^/]*\//g, ' ') // 발음기호 [féiməs], /ˈæpl/
      .replace(/^\s*\(?\d+[.)]?\s*/, '') // 앞 번호
      .trim();
    if (!line || HEADER.test(line)) continue;

    const segs = [...line.matchAll(SEGMENT)].map((m) =>
      m[1] ? { en: cleanWord(m[1]) } : { ko: cleanMeaning(m[2]) }
    ).filter((s) => (s.en !== undefined ? validWord(s.en) : s.ko));
    if (!segs.length) continue;

    // 한글만 있는 줄: 바로 윗줄의 영어 단어와 짝
    if (segs.every((s) => s.ko)) {
      const next = pending.find((p) => !p.meaning);
      if (next) {
        next.meaning = segs.map((s) => s.ko).join(' ');
        pairedFrom = 0;
      }
      continue;
    }

    // 영어 단어 하나만 있는 줄: 뒤에 나올 뜻을 기다린다
    if (segs.length === 1) {
      if (pairedFrom >= 0) flush(); // 이미 뜻 짝짓기가 시작된 묶음은 마감
      pending.push({ word: segs[0].en, meaning: '' });
      continue;
    }
    flush();
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].en === undefined) continue;
      const next = segs[i + 1];
      if (next?.ko) {
        out.push({ word: segs[i].en, meaning: next.ko });
        i++;
      } else {
        out.push({ word: segs[i].en, meaning: '' }); // 뜻을 못 읽음 → 직접 입력
      }
    }
  }
  flush();

  // 같은 단어 중복 제거
  const seen = new Set();
  return out.filter((w) => {
    const key = w.word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
