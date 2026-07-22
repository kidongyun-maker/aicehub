# AICE Hub - Cloudflare Worker (API 프록시)

OpenRouter API 키를 숨기면서 프론트엔드의 AI 요청을 중계하는 프록시 서버입니다.

## 배포 방법

### 방법 1: Cloudflare 대시보드 (간단)

1. [Cloudflare](https://dash.cloudflare.com) 로그인
2. Workers & Pages > Create > Create Worker
3. 이름: `aicehub-api`
4. `index.js` 코드를 붙여넣기
5. Deploy
6. Settings > Variables > Environment Variables
7. `OPENROUTER_API_KEY` 추가 (Encrypt 체크)
   - 키 발급: https://openrouter.ai/keys

### 방법 2: Wrangler CLI

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler secret put OPENROUTER_API_KEY
wrangler deploy
```

## 배포 후

Worker URL (예: `https://aicehub-api.your-account.workers.dev`)을 복사해서
프론트엔드 `js/config.js`의 `API_BASE_URL`에 넣으세요.

## 보안

- 무료 모델만 허용 (ALLOWED_FREE_MODELS 목록)
- 대화 길이 제한 (20턴)
- max_tokens 제한 (1024)
- CORS 설정으로 도메인 제한 가능
