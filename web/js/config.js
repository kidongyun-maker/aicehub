// Supabase 프로젝트 정보 (대시보드 > Project Settings > API)
// anon(publishable) 키는 공개되어도 되는 키입니다. 데이터는 RLS 정책으로 보호됩니다.
export const SUPABASE_URL = 'https://erxgvoqioytqvobrwwfq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_9-A3YEXWWvzZ_2-N5Cq_NQ_nze0aAQ8';

// 사진 AI 추출(Claude) 버튼 표시 여부.
// Supabase에 extract-words 함수를 배포하고 ANTHROPIC_API_KEY 를 등록한 뒤 true 로 바꾸세요.
// false 여도 무료 인식(Tesseract.js)은 항상 사용할 수 있습니다.
export const AI_EXTRACT_ENABLED = false;

// 최종 테스트 통과 기준 (%). supabase/schema.sql 의 submit_attempt 와 같은 값이어야 합니다.
export const PASS_RATE = 80;
