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
    // psm 4 = 한 줄씩 읽기 (단어장/표에서 가장 잘 맞음. 기본값 6은 표를 망가뜨림)
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '4' });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

// 인식 전처리: 흑백 + 대비 강화
async function preprocess(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * 사진에서 단어/뜻을 인식한다.
 * onProgress(percent, label) 로 진행 상황을 알려 준다.
 */
export async function recognizeWords(dataUrl, onProgress = () => {}) {
  progressHandler = (m) => {
    if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100), '글자 인식 중');
    else if (/loading|initializ/i.test(m.status)) onProgress(null, '인식 준비 중 (처음 한 번은 데이터 다운로드)');
  };
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(await preprocess(dataUrl));
    return parseWords(data.text);
  } finally {
    progressHandler = null;
  }
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
  let pendingWord = null; // 영어만 있는 줄 → 다음 줄이 한글만이면 짝으로
  const flush = () => {
    if (pendingWord) out.push({ word: pendingWord, meaning: '' });
    pendingWord = null;
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
      if (pendingWord) {
        out.push({ word: pendingWord, meaning: segs.map((s) => s.ko).join(' ') });
        pendingWord = null;
      }
      continue;
    }
    flush();

    // 영어 단어 하나만 있는 줄: 다음 줄 뜻을 기다린다
    if (segs.length === 1) {
      pendingWord = segs[0].en;
      continue;
    }
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
