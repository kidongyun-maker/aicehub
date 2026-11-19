-- 단어 암기장 - 직접 쓰기 단계 2개 추가 (뜻 직접 쓰기, 스펠링 직접 쓰기)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- (schema.sql 에도 같은 내용이 반영되어 있어, 새로 만드는 프로젝트는 schema.sql 만 실행하면 됩니다)

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
