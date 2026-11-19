// 음성 입력 (브라우저 내장 음성 인식 - Web Speech API)
// 안드로이드 크롬, 아이폰 사파리(14.5+), PC 크롬/엣지/사파리에서 동작한다. 파이어폭스는 지원하지 않는다.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = Boolean(Recognition);

const ERRORS = {
  'not-allowed': '마이크 사용이 막혀 있어요. 브라우저 설정에서 마이크를 허용해 주세요.',
  'service-not-allowed': '이 브라우저에서는 음성 인식을 쓸 수 없어요. 아이폰은 설정 > 일반 > 키보드 > 받아쓰기를 켜 주세요.',
  'no-speech': '목소리가 들리지 않았어요. 다시 눌러서 말해 주세요.',
  'audio-capture': '마이크를 찾을 수 없어요.',
  network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
};

let current = null;

/**
 * 한 번 듣고 끝난다. 말하는 동안 onText(중간 결과)가 여러 번 불리고, 끝나면 onEnd(최종 문장).
 * lang: 'ko-KR' (뜻) / 'en-US' (스펠링)
 * 반환값: 듣기를 멈추는 함수
 */
export function listen({ lang, onText = () => {}, onEnd = () => {}, onError = () => {} }) {
  if (!Recognition) {
    onError('이 브라우저는 음성 인식을 지원하지 않아요. 크롬이나 사파리를 써 주세요.');
    return () => {};
  }
  current?.abort();
  const rec = new Recognition();
  current = rec;
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = '';
  rec.onresult = (e) => {
    text = [...e.results].map((r) => r[0].transcript).join(' ').trim();
    onText(text);
  };
  rec.onerror = (e) => {
    if (e.error === 'aborted') return;
    onError(ERRORS[e.error] || `음성 인식 오류 (${e.error})`);
  };
  rec.onend = () => {
    if (current === rec) current = null;
    onEnd(text);
  };
  rec.start();
  return () => rec.stop();
}

// 스펠링을 말로 할 때: "A P P L E" / "a-p-p-l-e" 처럼 한 글자씩 말하면 붙여 준다. 끝의 마침표도 지운다.
export function toSpelling(text) {
  const t = text.trim().replace(/[.!?]+$/, '');
  const tokens = t.split(/[\s,.-]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((x) => /^[a-z]$/i.test(x))) return tokens.join('').toLowerCase();
  return t.toLowerCase();
}
