// Supabase Edge Function: 사진에서 영어 단어와 한국어 뜻을 추출한다.
// 필요한 비밀값: ANTHROPIC_API_KEY  (supabase secrets set ANTHROPIC_API_KEY=...)
import Anthropic from "npm:@anthropic-ai/sdk@1.10.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.10.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const WordList = z.object({
  words: z.array(
    z.object({
      word: z.string().describe("영어 단어 또는 숙어 (사진에 적힌 철자 그대로)"),
      meaning: z.string().describe("한국어 뜻 (짧게)"),
      inferred: z.boolean().describe("사진에 뜻이 없어 직접 채운 경우 true"),
    }),
  ),
});

const PROMPT = `이 사진은 학생의 영어 단어 학습 자료입니다(단어장, 교재, 시험지, 손글씨 메모 등).
사진에 나온 영어 단어/숙어와 그 한국어 뜻을 모두 추출하세요.

- 사진에 적힌 순서를 유지하세요.
- 사진에 뜻이 함께 적혀 있으면 그 뜻을 그대로 쓰고 inferred=false 로 표시하세요.
- 뜻이 없거나 읽을 수 없으면, 사진의 문맥에 맞는 짧은 한국어 뜻을 직접 채우고 inferred=true 로 표시하세요.
- 뜻이 여러 개면 쉼표로 구분해 핵심 1~3개만 쓰세요.
- 단어 철자는 사진 그대로 옮기되, 명백한 인쇄/OCR 잡음은 바로잡으세요.
- 번호, 발음기호, 예문, 품사 표시는 단어/뜻에 넣지 마세요.
- 영어 학습 단어가 없는 사진이면 빈 목록을 반환하세요.`;

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 로그인한 단어장 사용자(9585/5238)만 허용
  // 새 키(sb_publishable_...) 프로젝트도 동작하도록 요청에 실려 온 apikey 를 우선 사용
  const apiKey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, apiKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: code, error: authError } = await supabase.rpc("my_code");
  if (authError || !code) return json({ error: "로그인이 필요합니다." }, 401);

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    return json({ error: "AI 추출이 설정되지 않았습니다(ANTHROPIC_API_KEY). 단어를 직접 입력해 주세요." }, 503);
  }

  const { image } = await req.json().catch(() => ({}));
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(image ?? "");
  if (!m || m[1].length > 10_000_000) return json({ error: "사진 형식이 올바르지 않습니다." }, 400);

  try {
    const response = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: betaZodOutputFormat(WordList) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: m[1] } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return json({ error: "이 사진은 분석할 수 없습니다. 다른 사진을 올리거나 직접 입력해 주세요." }, 422);
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return json({ error: "단어가 너무 많아 추출이 중간에 끊겼습니다. 사진을 나눠서 올려 주세요." }, 422);
    }
    const words = response.parsed_output.words
      .map((w) => ({ word: w.word.trim(), meaning: w.meaning.trim(), inferred: w.inferred }))
      .filter((w) => w.word);
    return json({ words });
  } catch (err) {
    console.error("[extract-words]", err);
    return json({ error: describeApiError(err) }, 502);
  }
});

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다. ANTHROPIC_API_KEY 를 확인해 주세요.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 많아 잠시 후 다시 시도해 주세요.";
  if (err instanceof Anthropic.BadRequestError) return `요청 오류: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "AI 서버에 연결하지 못했습니다.";
  if (err instanceof Anthropic.APIError) return `AI 서버 오류 (${err.status ?? "알 수 없음"})`;
  return `단어 추출 중 오류: ${(err as Error).message}`;
}
