// Supabase 데이터 계층. 화면 코드(app.js)는 이 모듈만 사용한다.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PASS_RATE } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const USERS = {
  9585: { code: '9585', role: 'student', name: '학생' },
  5238: { code: '5238', role: 'parent', name: '부모' },
};
const STEPS = ['quiz', 'spell', 'final'];

// 사용자 번호 → Supabase 로그인 계정 (Supabase는 비밀번호 6자 이상이 필요해서 번호를 감싼다)
const emailOf = (code) => `u${code}@example.com`;
const passwordOf = (code) => `wordstudy-${code}`;

let me = null;

function check(error, fallback = '요청에 실패했습니다.') {
  if (error) throw new Error(error.message || fallback);
}

// crypto.randomUUID 는 https/localhost 에서만 된다. 집 와이파이(http://192.168...)에서도 되도록 직접 만든다.
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const newWordId = () => uuid().replace(/-/g, '').slice(0, 12);

// ---------- 인증 ----------

async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('code, role, name').eq('id', (await sb.auth.getUser()).data.user?.id).maybeSingle();
  check(error);
  me = data;
  return me;
}

export async function getMe() {
  if (!sb) return { user: null, passRate: PASS_RATE };
  const { data } = await sb.auth.getSession();
  if (!data.session) return { user: null, passRate: PASS_RATE };
  return { user: await loadProfile(), passRate: PASS_RATE };
}

export async function login(code) {
  if (!USERS[code]) throw new Error('사용자 번호가 올바르지 않습니다.');
  const { error } = await sb.auth.signInWithPassword({ email: emailOf(code), password: passwordOf(code) });
  if (error) {
    if (/rate|too many/i.test(error.message)) throw new Error('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    throw new Error('로그인에 실패했습니다. Supabase에 계정이 만들어졌는지 확인해 주세요.');
  }
  const user = await loadProfile();
  if (!user) {
    await sb.auth.signOut();
    throw new Error('프로필이 없습니다. supabase/schema.sql 을 실행했는지 확인해 주세요.');
  }
  return { user };
}

export async function logout() {
  await sb.auth.signOut();
  me = null;
}

// ---------- 요약 계산 ----------

function summarize(learned, attempts) {
  const full = (step) => attempts.filter((a) => a.step === step && a.mode === 'full');
  const out = { learnedAt: learned?.doneAt ?? null };
  for (const step of STEPS) {
    const list = full(step);
    const last = list.at(-1);
    out[step] = last
      ? { count: list.length, lastAccuracy: last.accuracy, bestAccuracy: Math.max(...list.map((a) => a.accuracy)), lastAt: last.at }
      : null;
  }
  out.passed = full('final').some((a) => a.accuracy >= PASS_RATE);
  out.lastActivity = [learned?.doneAt, attempts.at(-1)?.at].filter(Boolean).sort().at(-1) ?? null;
  return out;
}

const mapSet = (r) => ({
  id: r.id,
  title: r.title,
  createdAt: r.created_at,
  createdBy: r.created_by,
  createdByName: USERS[r.created_by]?.name ?? r.created_by,
  hasImage: r.has_image,
  wordCount: r.words.length,
  words: r.words,
});

const mapAttempt = (r) => ({
  id: r.id,
  setId: r.set_id,
  userCode: r.user_code,
  step: r.step,
  mode: r.mode,
  at: r.at,
  total: r.total,
  correct: r.correct,
  accuracy: r.accuracy,
  passed: r.passed,
  ...(r.items ? { items: r.items } : {}),
});

const ATTEMPT_COLS = 'id, set_id, user_code, step, mode, at, total, correct, accuracy, passed';

async function fetchProgress(codes, setId) {
  let la = sb.from('learned').select('set_id, user_code, done_at').in('user_code', codes);
  let at = sb.from('attempts').select(ATTEMPT_COLS).in('user_code', codes).order('at');
  if (setId) {
    la = la.eq('set_id', setId);
    at = at.eq('set_id', setId);
  }
  const [l, a] = await Promise.all([la, at]);
  check(l.error);
  check(a.error);
  return {
    learned: l.data.map((r) => ({ setId: r.set_id, userCode: r.user_code, doneAt: r.done_at })),
    attempts: a.data.map(mapAttempt),
  };
}

function summaryFor(progress, code, setId) {
  return summarize(
    progress.learned.find((l) => l.userCode === code && l.setId === setId),
    progress.attempts.filter((a) => a.userCode === code && a.setId === setId)
  );
}

async function allSets() {
  const { data, error } = await sb.from('word_sets').select('*').order('created_at', { ascending: false });
  check(error);
  return data.map(mapSet);
}

// ---------- 단어장 ----------

export async function listSets() {
  const [sets, progress] = await Promise.all([allSets(), fetchProgress([me.code])]);
  return { sets: sets.map(({ words, ...s }) => ({ ...s, summary: summaryFor(progress, me.code, s.id) })) };
}

export async function getSet(id) {
  const sets = await allSets();
  const set = sets.find((s) => s.id === id);
  if (!set) throw new Error('단어장을 찾을 수 없습니다.');
  // 5지선다 오답 보기가 부족할 때 쓸 다른 단어장의 뜻들
  const own = new Set(set.words.map((w) => w.meaning));
  const extraMeanings = [
    ...new Set(sets.filter((s) => s.id !== id).flatMap((s) => s.words.map((w) => w.meaning)).filter((m) => !own.has(m))),
  ]
    .sort(() => Math.random() - 0.5)
    .slice(0, 40);
  return { set, extraMeanings };
}

function cleanWords(words, previous = []) {
  const prevIds = new Set(previous.map((w) => w.id));
  return words
    .map((w) => ({
      id: prevIds.has(w.id) ? w.id : newWordId(),
      word: String(w.word ?? '').trim().slice(0, 100),
      meaning: String(w.meaning ?? '').trim().slice(0, 200),
    }))
    .filter((w) => w.word && w.meaning)
    .slice(0, 300);
}

function defaultTitle() {
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 단어`;
}

function dataUrlToBlob(dataUrl) {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

export async function createSet({ title, image, words }) {
  const cleaned = cleanWords(words);
  if (!cleaned.length) throw new Error('단어를 1개 이상 입력해 주세요.');
  const id = uuid();
  let hasImage = false;
  if (image) {
    const { error } = await sb.storage.from('photos').upload(`${id}.jpg`, dataUrlToBlob(image), { contentType: 'image/jpeg' });
    if (error) console.warn('사진 업로드 실패:', error.message);
    else hasImage = true;
  }
  const { data, error } = await sb
    .from('word_sets')
    .insert({ id, title: String(title || '').trim().slice(0, 60) || defaultTitle(), words: cleaned, has_image: hasImage, created_by: me.code })
    .select()
    .single();
  check(error);
  return { set: mapSet(data) };
}

export async function updateSet(id, { title, words }) {
  const { set } = await getSet(id);
  const cleaned = cleanWords(words, set.words);
  if (!cleaned.length) throw new Error('단어를 1개 이상 입력해 주세요.');
  const { data, error } = await sb
    .from('word_sets')
    .update({ title: String(title || '').trim().slice(0, 60) || set.title, words: cleaned, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  check(error);
  return { set: mapSet(data) };
}

export async function deleteSet(id) {
  const { data, error } = await sb.from('word_sets').delete().eq('id', id).select('id');
  check(error);
  if (!data.length) throw new Error('직접 올린 단어장만 삭제할 수 있습니다.');
  await sb.storage.from('photos').remove([`${id}.jpg`]);
}

const imageUrlCache = new Map();
export async function imageUrl(id) {
  if (imageUrlCache.has(id)) return imageUrlCache.get(id);
  const { data, error } = await sb.storage.from('photos').createSignedUrl(`${id}.jpg`, 60 * 60);
  check(error);
  imageUrlCache.set(id, data.signedUrl);
  return data.signedUrl;
}

export function downloadCsv(set) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + ['word,meaning', ...set.words.map((w) => `${esc(w.word)},${esc(w.meaning)}`)].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${set.title}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function extractWords(image) {
  const { data, error } = await sb.functions.invoke('extract-words', { body: { image } });
  if (error) {
    let msg = '단어 추출에 실패했습니다. 직접 입력해 주세요.';
    try {
      msg = (await error.context.json()).error || msg;
    } catch {
      if (/Failed to send|fetch/i.test(error.message)) msg = '추출 기능(Edge Function)이 아직 배포되지 않았습니다. 직접 입력해 주세요.';
    }
    throw new Error(msg);
  }
  return data;
}

// ---------- 학습 진행 / 결과 ----------

function resolveUser(code) {
  const target = code || me.code;
  if (target !== me.code && me.role !== 'parent') throw new Error('권한이 없습니다.');
  if (!USERS[target]) throw new Error('사용자를 찾을 수 없습니다.');
  return USERS[target];
}

export async function getProgress(setId, code) {
  const user = resolveUser(code);
  const progress = await fetchProgress([user.code], setId);
  const learned = progress.learned[0] || null;
  return {
    user,
    summary: summaryFor(progress, user.code, setId),
    step1: learned,
    attempts: [...progress.attempts].reverse(),
  };
}

export async function getAttempt(setId, attemptId, code) {
  const user = resolveUser(code);
  const { data, error } = await sb.from('attempts').select('*').eq('id', attemptId).eq('set_id', setId).maybeSingle();
  check(error);
  if (!data) throw new Error('결과를 찾을 수 없습니다.');
  return { attempt: mapAttempt(data), user };
}

export async function markLearned(setId, wordCount) {
  const { error } = await sb
    .from('learned')
    .upsert({ set_id: setId, user_code: me.code, done_at: new Date().toISOString(), word_count: wordCount });
  check(error);
}

export async function submitAttempt(setId, { step, mode, answers }) {
  const { data, error } = await sb.rpc('submit_attempt', { p_set_id: setId, p_step: step, p_mode: mode, p_answers: answers });
  check(error);
  return { attempt: mapAttempt(data) };
}

// 성적표: 학생은 본인, 부모는 학생+부모
export async function getReport() {
  const users = me.role === 'parent' ? [USERS[9585], USERS[5238]] : [USERS[me.code]];
  const codes = users.map((u) => u.code);
  const [sets, progress] = await Promise.all([allSets(), fetchProgress(codes)]);
  return {
    users,
    passRate: PASS_RATE,
    sets: sets.map(({ words, ...s }) => ({
      ...s,
      byUser: Object.fromEntries(codes.map((c) => [c, summaryFor(progress, c, s.id)])),
    })),
  };
}

// 다른 탭에서 로그아웃했거나 세션이 만료되면 알려 준다.
export function onSignedOut(fn) {
  sb?.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      me = null;
      fn();
    }
  });
}
