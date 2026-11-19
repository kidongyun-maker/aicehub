-- 단어 암기장 - 외부 API: AI 도구가 인증번호(사용자 번호)로 단어장을 만든다
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- 호출: POST {SUPABASE_URL}/rest/v1/rpc/api_add_words
--       헤더 apikey: {publishable key}, Content-Type: application/json
--       본문 {"code": "9585", "title": "3과 단어", "words": [{"word": "apple", "meaning": "사과"}]}
-- 설명서: https://aicehub.com/api/

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
