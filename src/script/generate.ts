import { z } from "zod";
import { runClaudeCode } from "../llm/claudeCode.js";
import type { ShortRow } from "../db.js";

/** 쿠팡 파트너스 약관이 요구하는 대가 표기 문구 */
export const COUPANG_DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";
export const SHOPPING_CONNECT_DISCLOSURE = "이 영상은 네이버 쇼핑커넥트 활동의 일환으로, 판매 시 수수료를 제공받습니다.";
/** 화면에 계속 띄우는 짧은 표기 */
export const ON_SCREEN_DISCLOSURE = "광고 · 수수료를 받을 수 있어요";

/** 사실 정보가 부족하거나 직접 써 봐야 알 수 있는 부분 — 사람이 채우기 전엔 렌더 불가 */
export const PLACEHOLDER = "[경험 추가]";

export const ScriptSchema = z.object({
  /** 첫 1~2초 훅 (한 문장) */
  hook: z.string().min(1).max(60),
  /** 본문 대사. 한 줄 = 자막 한 장면 */
  lines: z.array(z.object({ text: z.string().min(1).max(60), clipHint: z.string().max(80) })).min(3).max(10),
  /** 마무리 행동 유도 */
  cta: z.string().min(1).max(60),
  title: z.string().min(1).max(90),
  hashtags: z.array(z.string()).max(6),
});
export type Script = z.infer<typeof ScriptSchema>;

export function disclosureFor(program: ShortRow["program"]): string {
  return program === "SHOPPING_CONNECT" ? SHOPPING_CONNECT_DISCLOSURE : COUPANG_DISCLOSURE;
}

export const SYSTEM = `당신은 한국어 쇼핑 쇼츠(15~30초) 대본 작가입니다.
규칙:
- 사용자가 준 "확인된 사실" 안에서만 말합니다. 가격·수치·효능·판매량·후기·"써 봤더니" 같은 경험을 지어내지 마세요.
- 사실만으로 부족하거나 직접 사용해 봐야 알 수 있는 부분은 문장 안에 ${PLACEHOLDER} 를 그대로 넣으세요. 사람이 나중에 채웁니다.
- 과장·최상급 단정("무조건", "최고", "100%")과 의학적 효능 주장을 쓰지 마세요.
- 다른 사람 영상의 대사를 흉내 내지 말고 새로 씁니다.
- 한 줄은 자막 한 장면(말하면 2~4초)이 되도록 짧게. 전체 낭독 20~30초.
- hook 은 문제 상황이나 궁금증으로 시작, cta 는 "제품 정보는 프로필 링크에서" 류로 부드럽게.
- clipHint 에는 그 줄에 어울리는 화면(직접 촬영·스톡에서 찾을 장면)을 짧게 적으세요.
- title 은 60자 이내, hashtags 는 #쇼츠 포함 최대 6개.`;

export function buildPrompt(short: Pick<ShortRow, "productName" | "category" | "facts">): string {
  const facts = short.facts.length ? short.facts.map((f) => `- ${f}`).join("\n") : "- (없음: 제품명 외에는 모두 " + PLACEHOLDER + " 로 두세요)";
  return `제품명: ${short.productName}
카테고리: ${short.category ?? "미정"}
확인된 사실(상품 페이지·직접 사용으로 확인한 것만):
${facts}

위 제품의 쇼핑 쇼츠 대본을 JSON 으로 작성하세요.`;
}

/** 대본의 모든 대사 (훅 → 본문 → CTA 순) */
export function narrationLines(script: Script): string[] {
  return [script.hook, ...script.lines.map((l) => l.text), script.cta];
}

export function placeholdersIn(script: Script): string[] {
  return narrationLines(script).filter((t) => t.includes(PLACEHOLDER));
}

export async function generateScript(short: ShortRow): Promise<Script> {
  const res = await runClaudeCode({
    system: SYSTEM,
    prompt: buildPrompt(short),
    jsonSchema: z.toJSONSchema(ScriptSchema),
  });
  const raw = res.structured ?? extractJson(res.text);
  return ScriptSchema.parse(raw);
}

function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("대본 응답에서 JSON 을 찾지 못했어요.");
  return JSON.parse(m[0]);
}

/** 유튜브 설명란 — 대가 표기를 맨 위에 둡니다 */
export function buildDescription(short: ShortRow, script: Script, linkNote = "제품 정보는 프로필 링크에서 확인하세요."): string {
  return [disclosureFor(short.program), "", linkNote, "", script.hashtags.join(" ")].join("\n").trim();
}
