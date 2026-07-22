/**
 * AICE Hub - Cloudflare Worker API Proxy
 * 
 * OpenRouter API 키를 숨기면서 프론트엔드 요청을 중계합니다.
 * 무료 모델만 허용하여 비용을 방지합니다.
 * 
 * 배포 방법:
 * 1. Cloudflare 계정 생성 (무료)
 * 2. Workers & Pages > Create Worker
 * 3. 이 코드를 붙여넣기
 * 4. Settings > Variables에 OPENROUTER_API_KEY 환경변수 추가
 * 5. Save and Deploy
 */

// 허용된 무료 모델 목록 (이 목록에 없는 모델은 거부)
const ALLOWED_FREE_MODELS = [
    'meta-llama/llama-3.1-8b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemma-2-9b-it:free',
    'microsoft/phi-3-mini-128k-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free',
];

// CORS 헤더
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        // POST만 허용
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
        }

        try {
            const body = await request.json();
            const { model, messages } = body;

            // 모델 검증 - 무료 모델만 허용
            if (!model || !ALLOWED_FREE_MODELS.includes(model)) {
                return new Response(JSON.stringify({ 
                    error: '허용되지 않은 모델입니다. 무료 모델만 사용 가능합니다.',
                    allowed_models: ALLOWED_FREE_MODELS
                }), {
                    status: 400,
                    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                });
            }

            // 메시지 검증
            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return new Response(JSON.stringify({ error: '메시지가 필요합니다.' }), {
                    status: 400,
                    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                });
            }

            // 메시지 길이 제한 (남용 방지)
            if (messages.length > 20) {
                return new Response(JSON.stringify({ error: '대화 길이가 너무 깁니다. (최대 20턴)' }), {
                    status: 400,
                    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                });
            }

            // OpenRouter API 호출
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://aicehub.com',
                    'X-Title': 'AICE Hub',
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    max_tokens: 1024,
                    temperature: 0.7,
                }),
            });

            const data = await response.json();

            // 에러 처리
            if (!response.ok) {
                return new Response(JSON.stringify({ 
                    error: data.error?.message || 'AI 응답 생성 중 오류가 발생했습니다.' 
                }), {
                    status: response.status,
                    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                });
            }

            // 성공 응답
            return new Response(JSON.stringify({
                content: data.choices?.[0]?.message?.content || '응답을 생성하지 못했습니다.',
                model: data.model,
                usage: data.usage,
            }), {
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: '서버 오류가 발생했습니다.' }), {
                status: 500,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
        }
    },
};
