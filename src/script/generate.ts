import { z } from "zod";
import { runClaudeCode } from "../llm/claudeCode.js";
import type { ShortRow } from "../db.js";

/** 쿠팡 파트너스 약관이 요구하는 대가 표기 문구 */
export const COUPANG_DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";
export const SHOPPING_CONNECT_DISCLOSURE = "이 콘텐츠는 네이버 쇼핑커넥트 활동의 일환으로, 판매 시 수수료를 제공받습니다.";
/** 화면에 계속 띄우는 짧은 표기 (플랫폼 공통) */
export const ON_SCREEN_DISCLOSURE = "광고 · 제휴 링크로 수수료를 받을 수 있어요";

/** 사실 정보가 부족하거나 직접 써 봐야 알 수 있는 부분 — 사람이 채우기 전엔 렌더 불가 */
export const PLACEHOLDER = "[경험 추가]";
/** facts 중 이 접두어로 시작하는 것만 사람이 직접 확인한 사용 경험으로 봅니다. */
export const EXPERIENCE_PREFIX = "경험:";

const Line = z.string().min(1).max(40);

export const ScriptSchema = z.object({
  /** 첫 2초 훅 후보 5개 — 사람이 hookIndex 로 고름 */
  hooks: z.array(Line).min(3).max(5),
  hookIndex: z.number().int().min(0).default(0),
  /** 공감: 시청자가 겪는 불편 (1~2줄) */
  problem: z.array(z.object({ text: Line, clipHint: z.string().max(80) })).min(1).max(2),
  /** 해결: 제품이 어떻게 해결하는지 (2~4줄) */
  solution: z.array(z.object({ text: Line, clipHint: z.string().max(80) })).min(2).max(4),
  /** 말로 하는 마무리(플랫폼 공통) — 저장·공유 유도 */
  cta: Line,
  /** 인스타 댓글 키워드 (댓글에 이 단어를 남기면 DM 으로 링크) */
  commentKeyword: z.string().min(1).max(10),
  titles: z.array(z.string().min(1).max(60)).min(1).max(3),
  hashtags: z.array(z.string()).max(8),
});
export type Script = z.infer<typeof ScriptSchema>;
export type ScriptInput = z.input<typeof ScriptSchema>;

export type LineRole = "HOOK" | "PROBLEM" | "SOLUTION" | "CTA";
export type NarrationLine = { text: string; role: LineRole };

export const SYSTEM = `당신은 한국어 쇼핑 쇼츠(15~30초) 대본 작가입니다. 형식은 리뷰가 아니라 "이런 제품이 있다"는 정보·발견형입니다.
구조: 훅(첫 2초) → 공감(시청자의 불편) → 해결(제품이 어떻게 해결하는지) → 마무리(저장·공유 유도).
규칙:
- 사용자가 준 "확인된 사실" 안에서만 말합니다. 가격·수치·효능·판매량·후기를 지어내지 마세요.
- 1인칭 사용 경험("써 보니", "제가 써봤는데", "내돈내산", "직접 사용해 보니")은 "${EXPERIENCE_PREFIX}" 로 시작하는 사실이 있을 때 그 내용만 쓸 수 있습니다. 없으면 절대 쓰지 마세요.
- 사실만으로 부족한 부분은 문장 안에 ${PLACEHOLDER} 를 그대로 넣으세요. 사람이 채웁니다.
- 과장·최상급 단정("무조건", "최고", "100%")과 의학·위생 효능 주장을 쓰지 마세요.
- 다른 사람 영상의 대사를 흉내 내지 말고 새로 씁니다.
- 한 줄은 말하면 2~3초(25자 이내). 전체 낭독 20~30초.
- hooks 는 서로 다른 각도의 훅 5개(질문형, 문제 제기형, 반전형, 숫자형은 확인된 사실이 있을 때만, 상황 묘사형).
- clipHint 에는 그 줄에 어울리는 장면을 스톡 영상 검색어로 쓸 수 있게 짧은 영어 키워드로 적으세요(예: "messy kitchen drawer").
- cta 는 "필요할 때 보게 저장해 두세요" 류. 링크 안내는 넣지 마세요(플랫폼마다 다름).
- commentKeyword 는 제품을 대표하는 2~4글자 한국어 단어.
- titles 는 40자 이내 3개, hashtags 는 #쇼츠 #살림템 포함 최대 8개.`;

export function buildPrompt(short: Pick<ShortRow, "productName" | "category" | "facts">, solves?: string | null): string {
  const facts = short.facts.length ? short.facts.map((f) => `- ${f}`).join("\n") : `- (없음: 제품명 외에는 모두 ${PLACEHOLDER} 로 두세요)`;
  return `제품명: ${short.productName}
카테고리: ${short.category ?? "미정"}
해결하는 문제: ${solves ?? "미정"}
확인된 사실(상품 페이지에서 확인한 것만. "${EXPERIENCE_PREFIX}" 로 시작하면 사람이 직접 써 본 경험):
${facts}

위 제품의 쇼핑 쇼츠 대본을 JSON 으로 작성하세요.`;
}

/** 대사 순서: 선택한 훅 → 공감 → 해결 → 마무리 */
export function narration(script: Script): NarrationLine[] {
  const hook = script.hooks[Math.min(script.hookIndex, script.hooks.length - 1)]!;
  return [
    { text: hook, role: "HOOK" },
    ...script.problem.map((l) => ({ text: l.text, role: "PROBLEM" as const })),
    ...script.solution.map((l) => ({ text: l.text, role: "SOLUTION" as const })),
    { text: script.cta, role: "CTA" },
  ];
}

export function narrationLines(script: Script): string[] {
  return narration(script).map((l) => l.text);
}

export function placeholdersIn(script: Script): string[] {
  return narrationLines(script).filter((t) => t.includes(PLACEHOLDER));
}

const FIRST_PERSON = /(써\s?보니|써\s?봤|써\s?본|내돈내산|직접\s?(사용|써|사서)|사용해\s?보니|사용해\s?봤|제가\s?(쓰|써|사))/;

/** 사람이 확인한 경험(facts 의 "경험:")이 없는데 1인칭 사용 경험을 말하면 가짜 후기(공정위 지침 위반)입니다. */
export function fakeExperienceLines(script: Script, facts: string[]): string[] {
  if (facts.some((f) => f.trim().startsWith(EXPERIENCE_PREFIX))) return [];
  return narrationLines(script).filter((t) => FIRST_PERSON.test(t));
}

export async function generateScript(short: ShortRow, solves?: string | null): Promise<Script> {
  const res = await runClaudeCode({
    system: SYSTEM,
    prompt: buildPrompt(short, solves),
    jsonSchema: z.toJSONSchema(ScriptSchema.omit({ hookIndex: true })),
  });
  const raw = res.structured ?? extractJson(res.text);
  return ScriptSchema.parse(raw);
}

function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("대본 응답에서 JSON 을 찾지 못했어요.");
  return JSON.parse(m[0]);
}
