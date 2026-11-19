-- 단어 암기장 - Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.

-- ---------- 사용자 프로필 ----------
-- 로그인 계정: u9585@example.com (학생), u5238@example.com (부모)
create table if not exists public.profiles (
  id   uuid primary key references auth.users on delete cascade,
  code text unique not null,
  role text not null check (role in ('student', 'parent')),
  name text not null
);

create or replace function public.profile_from_email(p_email text)
returns table (code text, role text, name text)
language sql immutable as $$
  select c, case c when '5238' then 'parent' else 'student' end, case c when '5238' then '부모' else '학생' end
  from (select substring(p_email from '^u(9585|5238)@') as c) s
  where c is not null
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, code, role, name)
  select new.id, p.code, p.role, p.name from public.profile_from_email(new.email) p
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 스키마보다 먼저 만든 계정도 프로필 연결
insert into public.profiles (id, code, role, name)
select u.id, p.code, p.role, p.name
from auth.users u cross join lateral public.profile_from_email(u.email) p
on conflict (id) do nothing;

create or replace function public.my_code()
returns text language sql stable security definer set search_path = public as $$
  select code from public.profiles where id = auth.uid()
$$;

create or replace function public.is_parent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'parent' from public.profiles where id = auth.uid()), false)
$$;

-- ---------- 단어장 ----------
create table if not exists public.word_sets (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 60),
  words      jsonb not null,                 -- [{id, word, meaning}]
  has_image  boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- ---------- 1단계 암기 완료 ----------
create table if not exists public.learned (
  set_id     uuid not null references public.word_sets on delete cascade,
  user_code  text not null,
  done_at    timestamptz not null default now(),
  word_count int,
  primary key (set_id, user_code)
);

-- ---------- 시험 결과 ----------
create table if not exists public.attempts (
  id        uuid primary key default gen_random_uuid(),
  set_id    uuid not null references public.word_sets on delete cascade,
  user_code text not null,
  step      text not null check (step in ('quiz', 'spell', 'meaning_write', 'spell_write', 'final')),
  mode      text not null check (mode in ('full', 'retry')),
  at        timestamptz not null default now(),
  total     int not null,
  correct   int not null,
  accuracy  int not null,
  passed    boolean,
  items     jsonb not null
);
create index if not exists attempts_user_set on public.attempts (user_code, set_id, at);

-- ---------- 권한 (RLS) ----------
alter table public.profiles  enable row level security;
alter table public.word_sets enable row level security;
alter table public.learned   enable row level security;
alter table public.attempts  enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

-- 단어장: 로그인한 사용자 모두 보기/만들기/수정, 삭제는 올린 사람 또는 부모
drop policy if exists sets_read on public.word_sets;
drop policy if exists sets_insert on public.word_sets;
drop policy if exists sets_update on public.word_sets;
drop policy if exists sets_delete on public.word_sets;
create policy sets_read   on public.word_sets for select to authenticated using (my_code() is not null);
create policy sets_insert on public.word_sets for insert to authenticated with check (created_by = my_code());
create policy sets_update on public.word_sets for update to authenticated using (my_code() is not null);
create policy sets_delete on public.word_sets for delete to authenticated using (created_by = my_code() or is_parent());

-- 학습 기록: 본인 것만 쓰기, 보기는 본인 또는 부모
drop policy if exists learned_read on public.learned;
drop policy if exists learned_write on public.learned;
drop policy if exists learned_update on public.learned;
create policy learned_read   on public.learned for select to authenticated using (user_code = my_code() or is_parent());
create policy learned_write  on public.learned for insert to authenticated with check (user_code = my_code());
create policy learned_update on public.learned for update to authenticated using (user_code = my_code());

-- 시험 결과: 직접 insert 불가 (submit_attempt 함수로만 채점·저장), 보기는 본인 또는 부모
drop policy if exists attempts_read on public.attempts;
create policy attempts_read on public.attempts for select to authenticated using (user_code = my_code() or is_parent());

-- ---------- 채점 (서버에서 정답 비교) ----------
-- (예전에 만든 프로젝트도 맞춰지도록 단계 제약을 다시 만든다)
-- 1) 시험 단계 종류에 meaning_write, spell_write 추가
alter table public.attempts drop constraint if exists attempts_step_check;
alter table public.attempts add constraint attempts_step_check
  check (step in ('quiz', 'spell', 'meaning_write', 'spell_write', 'final'));

-- 2) 뜻 직접 쓰기 채점: 뜻 중 하나만 맞게 써도 정답
--    "성공하다; 뒤를 잇다" → "성공하다" 도, "뒤를 잇다" 도 정답
--    띄어쓰기·~·괄호는 무시, "(필름을) 현상하다" → "현상하다" 도 "필름을 현상하다" 도 정답
--    "연락" ↔ "연락하다" 처럼 '하다' 차이도 정답
create or replace function public.meaning_matches(p_answer text, p_meaning text)
returns boolean language sql immutable as $$
  with
  ans as (
    select lower(regexp_replace(a, '[\s~·.,!?''"()\[\]-]', '', 'g')) as plain,
           lower(regexp_replace(regexp_replace(a, '\([^)]*\)', '', 'g'), '[\s~·.,!?''"()\[\]-]', '', 'g')) as bare
    from regexp_split_to_table(coalesce(p_answer, ''), '[,;/]') a
  ),
  mean as (
    select lower(regexp_replace(m, '[\s~·.,!?''"()\[\]-]', '', 'g')) as plain,
           lower(regexp_replace(regexp_replace(m, '\([^)]*\)', '', 'g'), '[\s~·.,!?''"()\[\]-]', '', 'g')) as bare
    from regexp_split_to_table(coalesce(p_meaning, ''), '[,;/]') m
  )
  select exists (
    select 1
    from ans a, mean m, lateral (values (a.plain), (a.bare)) x(av), lateral (values (m.plain), (m.bare)) y(mv)
    where x.av <> '' and y.mv <> ''
      and (x.av = y.mv or x.av || '하다' = y.mv or x.av = y.mv || '하다')
  )
$$;

-- 3) 채점 함수: 새 단계와 문제 유형 처리
create or replace function public.submit_attempt(p_set_id uuid, p_step text, p_mode text, p_answers jsonb)
returns public.attempts
language plpgsql security definer set search_path = public as $$
declare
  v_code    text := public.my_code();
  v_set     public.word_sets;
  v_items   jsonb := '[]'::jsonb;
  a         jsonb;
  w         jsonb;
  v_type    text;
  v_ans     text;
  v_ok      boolean;
  v_total   int := 0;
  v_correct int := 0;
  v_full    boolean;
  v_acc     int;
  v_row     public.attempts;
begin
  if v_code is null then raise exception '로그인이 필요합니다.'; end if;
  if p_step not in ('quiz', 'spell', 'meaning_write', 'spell_write', 'final') then raise exception '잘못된 단계입니다.'; end if;
  select * into v_set from public.word_sets where id = p_set_id;
  if not found then raise exception '단어장을 찾을 수 없습니다.'; end if;

  for a in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    w := null;
    select x into w from jsonb_array_elements(v_set.words) x where x->>'id' = a->>'wordId' limit 1;
    continue when w is null;
    v_type := case when a->>'type' in ('spell', 'meaning_write', 'spell_write') then a->>'type' else 'meaning' end;
    v_ans  := left(coalesce(a->>'answer', ''), 200);
    if v_type in ('spell', 'spell_write') then
      v_ok := lower(regexp_replace(trim(v_ans), '\s+', ' ', 'g')) = lower(regexp_replace(trim(w->>'word'), '\s+', ' ', 'g'));
    elsif v_type = 'meaning_write' then
      v_ok := public.meaning_matches(v_ans, w->>'meaning');
    else
      v_ok := trim(v_ans) = w->>'meaning';
    end if;
    v_items := v_items || jsonb_build_object(
      'wordId', w->>'id', 'word', w->>'word', 'meaning', w->>'meaning',
      'type', v_type, 'answer', v_ans, 'correct', v_ok);
    v_total := v_total + 1;
    if v_ok then v_correct := v_correct + 1; end if;
  end loop;

  if v_total = 0 then raise exception '제출된 답이 없습니다.'; end if;
  v_full := coalesce(p_mode, 'full') <> 'retry' and v_total >= jsonb_array_length(v_set.words);
  v_acc  := round(v_correct * 100.0 / v_total);

  insert into public.attempts (set_id, user_code, step, mode, total, correct, accuracy, passed, items)
  values (p_set_id, v_code, p_step, case when v_full then 'full' else 'retry' end,
          v_total, v_correct, v_acc,
          case when p_step = 'final' and v_full then v_acc >= 80 end,  -- 통과 기준 80%
          v_items)
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.submit_attempt(uuid, text, text, jsonb) from public, anon;
grant execute on function public.submit_attempt(uuid, text, text, jsonb) to authenticated;
grant execute on function public.meaning_matches(text, text) to authenticated;

-- ---------- 사진 저장소 ----------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_read on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_delete on storage.objects;
create policy photos_read   on storage.objects for select to authenticated using (bucket_id = 'photos' and public.my_code() is not null);
create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.my_code() is not null);
create policy photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.my_code() is not null);

-- ---------- 테이블 접근 권한 (새 Supabase 프로젝트는 자동으로 주지 않음) ----------
-- 실제로 어떤 행을 볼 수 있는지는 위의 RLS 정책이 결정한다.
grant usage on schema public to authenticated;
grant select                         on public.profiles  to authenticated;
grant select, insert, update, delete on public.word_sets to authenticated;
grant select, insert, update         on public.learned   to authenticated;
grant select                         on public.attempts  to authenticated;
grant execute on function public.my_code()   to authenticated;
grant execute on function public.is_parent() to authenticated;

-- ---------- 외부 API (migrations/003_api.sql 과 같음) ----------
create or replace function public.api_add_words(code text, words jsonb, title text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code    text := trim(coalesce(code, ''));
  v_title   text := left(trim(coalesce(title, '')), 60);
  v_words   jsonb := '[]'::jsonb;
  v_skipped int := 0;
  v_recent  int;
  v_id      uuid := gen_random_uuid();
  x         jsonb;
  v_word    text;
  v_meaning text;
begin
  if not exists (select 1 from public.profiles p where p.code = v_code) then
    raise exception '인증번호(code)가 올바르지 않습니다.' using errcode = '28000';
  end if;
  if jsonb_typeof(words) is distinct from 'array' then
    raise exception 'words 는 [{"word": "apple", "meaning": "사과"}] 형식의 배열이어야 합니다.' using errcode = '22023';
  end if;
  -- 너무 많이 만드는 것 막기: 번호당 1시간에 30개
  select count(*) into v_recent from public.word_sets s
   where s.created_by = v_code and s.created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception '잠시 후 다시 시도해 주세요 (1시간에 30개까지).' using hint = 'rate_limit';
  end if;

  for x in select * from jsonb_array_elements(words) loop
    -- {"word","meaning"} 기본, {"en","ko"} / ["apple","사과"] 도 받아 준다
    if jsonb_typeof(x) = 'array' then
      v_word := x->>0; v_meaning := x->>1;
    elsif jsonb_typeof(x) = 'object' then
      v_word := coalesce(x->>'word', x->>'en', x->>'english');
      v_meaning := coalesce(x->>'meaning', x->>'ko', x->>'korean');
    else
      v_word := null; v_meaning := null;
    end if;
    v_word := left(regexp_replace(trim(coalesce(v_word, '')), '\s+', ' ', 'g'), 100);
    v_meaning := left(trim(coalesce(v_meaning, '')), 200);
    if v_word = '' or v_meaning = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    exit when jsonb_array_length(v_words) >= 300;
    v_words := v_words || jsonb_build_object(
      'id', left(replace(gen_random_uuid()::text, '-', ''), 12), 'word', v_word, 'meaning', v_meaning);
  end loop;

  if jsonb_array_length(v_words) = 0 then
    raise exception '저장할 단어가 없습니다. 각 항목에 word 와 meaning 이 모두 있어야 합니다.' using errcode = '22023';
  end if;
  if v_title = '' then
    v_title := extract(month from now() at time zone 'Asia/Seoul')::int || '월 '
            || extract(day from now() at time zone 'Asia/Seoul')::int || '일 단어';
  end if;

  insert into public.word_sets (id, title, words, has_image, created_by)
  values (v_id, v_title, v_words, false, v_code);

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'title', v_title,
    'count', jsonb_array_length(v_words),
    'skipped', v_skipped,
    'url', 'https://aicehub.com/#/set/' || v_id
  );
end $$;

revoke all on function public.api_add_words(text, jsonb, text) from public;
grant execute on function public.api_add_words(text, jsonb, text) to anon, authenticated;
