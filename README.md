# 📘 단어 암기장

교재·단어장 사진을 올리면 영어 단어와 뜻을 정리해 주고, 4단계로 외우고 시험 보는 웹앱입니다.
화면은 GitHub Pages(정적 사이트)에서, 데이터·로그인·사진·AI 추출은 Supabase(무료)에서 동작합니다. 직접 관리하는 서버는 없습니다.

```
web/                         정적 사이트 (GitHub Pages 배포)
  js/config.js               Supabase 주소/키 설정
  js/ocr.js                  무료 사진 인식 (Tesseract.js) + 단어/뜻 분리
  js/db.js                   데이터 계층 (Supabase)
  js/app.js                  화면
supabase/schema.sql          테이블·권한·채점 함수 (SQL Editor에서 실행)
supabase/functions/extract-words/   (선택) AI 사진 추출 (Claude API 키 보관)
```

## 사용자

| 번호 | 역할 | 할 수 있는 것 |
|---|---|---|
| 9585 | 학생 | 사진 업로드, 학습·시험, 내 성적표 |
| 5238 | 부모 | 사진 업로드, 학습·시험, 학생·부모 성적표(최종 정답률·통과 여부), 단어장 삭제 |

학습 기록과 정답률은 사용자별로 따로 저장됩니다.

## 학습 단계

1. **단어 암기**: 플래시카드를 눌러 뜻 확인, 발음 듣기, "한 번 더"를 누르면 뒤에 다시 나옴
2. **뜻 맞추기**: 5지선다
3. **스펠링 맞추기**: 섞인 알파벳을 순서대로 누르기 (PC는 키보드 입력 가능)
4. **최종 테스트**: 뜻·스펠링 문제를 섞어서 출제하고, **80% 이상이면 통과**

각 단계는 이전 단계를 한 번 끝내야 열립니다. 시험이 끝나면 정답률과 맞은/틀린 단어를 보여 주고, **틀린 것만 다시** 풀 수 있습니다. 채점은 DB 함수(`submit_attempt`)에서 합니다.

## Supabase 설정 (최초 1회)

1. [supabase.com](https://supabase.com)에 가입하고 **New project**를 만듭니다. 리전은 Northeast Asia (Seoul)을 고릅니다.
2. **Authentication → Sign In / Providers**에서 **Allow new users to sign up**을 끕니다.
3. **SQL Editor**에 `supabase/schema.sql` 전체를 붙여넣고 **Run**을 누릅니다.
4. **Authentication → Users → Add user → Create new user**에서 두 계정을 만듭니다. 이때 **Auto Confirm User**를 체크합니다.
   - `u9585@example.com` / 비밀번호 `wordstudy-9585`
   - `u5238@example.com` / 비밀번호 `wordstudy-5238`
5. **Project Settings → API**에서 Project URL과 anon(public) 키를 복사해 `web/js/config.js`에 넣습니다.
6. (선택) AI 추출은 **Edge Functions → Deploy a new function → Via Editor**에서 설정합니다.
   - 이름은 `extract-words`로 하고, `supabase/functions/extract-words/index.ts` 내용을 붙여넣어 배포합니다.
   - **Edge Functions → Secrets**에 `ANTHROPIC_API_KEY`를 추가합니다.
   - `web/js/config.js`의 `AI_EXTRACT_ENABLED`를 `true`로 바꿉니다.

## 사진 인식

- **무료 인식 (기본)**: [Tesseract.js](https://github.com/naptha/tesseract.js) 오픈소스 OCR이 휴대폰 브라우저 안에서 돌아갑니다. 서버와 API 키가 필요 없습니다. 처음 한 번 인식 데이터(약 4.5MB)를 내려받습니다.
  - 인쇄된 단어장이나 교재에서 잘 동작합니다. 손글씨는 거의 읽지 못합니다.
  - 읽은 결과는 수정 표에 채워집니다. 뜻을 못 읽은 단어는 빨간 칸으로 표시되니 직접 적어 주세요.
- **AI 인식 (선택)**: 위 6번을 설정하면 "✨ AI로 정확하게" 버튼이 생깁니다. Claude가 손글씨나 복잡한 사진도 읽고, 사진에 없는 뜻도 채워 줍니다. 사진 1장에 약 2~5센트가 듭니다.

> 로그인은 사용자 번호만 입력하는 방식이라, 번호를 아는 사람은 누구나 들어올 수 있습니다(가족용 수준의 보안).
> 다른 이메일로 가입된 계정은 프로필이 없어서 어떤 데이터에도 접근할 수 없습니다.

## 로컬에서 보기

```bash
python3 -m http.server 3000 -d web   # http://localhost:3000
```

## 배포

`main`에 푸시하면 GitHub Actions가 `web/` 폴더를 GitHub Pages에 배포합니다. 저장소의 Settings → Pages → Source는 **GitHub Actions**로 설정되어 있어야 합니다.
