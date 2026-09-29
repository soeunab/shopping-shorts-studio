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
/** 해시태그: 공백 없이, # 로 시작 */
const Tag = z.string().transform((t) => `#${t.replace(/^#+/, "").replace(/\s+/g, "")}`);
const ScriptLine = z.object({
  text: Line,
  clipHint: z.string().max(80),
  /** 자막에서 색으로 강조할 핵심 단어 1개 (그 줄에 실제로 있는 단어) */
  emphasis: z.string().max(12).optional(),
});

export const HOOK_TYPES = ["질문", "문제", "반전", "숫자", "상황"] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/** LLM 이 채우는 대본 구조 (JSON 스키마로도 전달) */
export const ScriptCore = z.object({
  /** 첫 2초 훅 후보 — 사람이 hookIndex 로 고름 */
  hooks: z.array(Line).min(3).max(5),
  /** 훅마다 유형 — 성과를 유형별로 비교하는 데 씀 */
  hookTypes: z.array(z.enum(HOOK_TYPES)).max(5).default([]),
  hookIndex: z.number().int().min(0).default(0),
  /** 사람들이 실제로 검색할 문제·상황 검색어 (제품명 아님). 맨 앞이 대표 키워드 */
  searchKeywords: z.array(z.string().min(2).max(20)).max(5).default([]),
  /** 첫 1.5초 화면 제목 카드 (12자 이내, 대표 키워드 포함) */
  onScreenTitle: z.string().max(20).optional(),
  /** 공감: 시청자가 겪는 불편 (1~2줄) */
  problem: z.array(ScriptLine).min(1).max(2),
  /** 해결: 제품이 어떻게 해결하는지 (2~4줄) */
  solution: z.array(ScriptLine).min(2).max(4),
  /** 말로 하는 마무리(플랫폼 공통) — 저장·공유 유도 */
  cta: Line,
  /** 인스타 댓글 키워드 (댓글에 이 단어를 남기면 DM 으로 링크) */
  commentKeyword: z.string().min(1).max(10),
  titles: z.array(z.string().min(1).max(60)).min(1).max(3),
  /** 넓은 태그 1 + 중간 태그 2 + 구체 태그 1~2 */
  hashtags: z.object({ broad: z.array(Tag).max(2), mid: z.array(Tag).max(3), specific: z.array(Tag).max(3) }),
});

/** 옛 script.json(해시태그 배열) → 새 구조 */
function migrateLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.hashtags)) {
    const tags = (r.hashtags as string[]).filter((t) => !/^#?(쇼츠|shorts)$/i.test(t.trim()));
    return { ...r, hashtags: { broad: tags.slice(0, 1), mid: tags.slice(1, 3), specific: tags.slice(3, 5) } };
  }
  return raw;
}

export const ScriptSchema = z.preprocess(migrateLegacy, ScriptCore);
export type Script = z.infer<typeof ScriptCore>;

/** 넓은 → 중간 → 구체 순서의 해시태그 (중복 제거) */
export function allHashtags(script: Script): string[] {
  return [...new Set([...script.hashtags.broad, ...script.hashtags.mid, ...script.hashtags.specific])];
}

export type LineRole = "HOOK" | "PROBLEM" | "SOLUTION" | "CTA";
export type NarrationLine = { text: string; role: LineRole; emphasis?: string };

export const SYSTEM = `당신은 한국어 쇼핑 쇼츠(15~30초) 대본 작가입니다. 형식은 리뷰가 아니라 "이런 제품이 있다"는 정보·발견형입니다.
구조: 훅(첫 2초) → 공감(시청자의 불편) → 해결(제품이 어떻게 해결하는지) → 마무리(저장·공유 유도).
규칙:
- 사용자가 준 "확인된 사실" 안에서만 말합니다. 가격·수치·효능·판매량·후기를 지어내지 마세요.
- 1인칭 사용 경험("써 보니", "제가 써봤는데", "내돈내산", "직접 사용해 보니")은 "${EXPERIENCE_PREFIX}" 로 시작하는 사실이 있을 때 그 내용만 쓸 수 있습니다. 없으면 절대 쓰지 마세요.
- 사실만으로 부족한 부분은 문장 안에 ${PLACEHOLDER} 를 그대로 넣으세요. 사람이 채웁니다.
- 과장·최상급 단정("무조건", "최고", "100%")과 의학·위생 효능 주장을 쓰지 마세요.
- 다른 사람 영상의 대사를 흉내 내지 말고 새로 씁니다.
- 한 줄은 말하면 2~3초(25자 이내). 전체 낭독 20~30초.
- hooks 는 서로 다른 각도의 훅 5개, hookTypes 에 각 훅의 유형(${HOOK_TYPES.join("/")})을 같은 순서로. 숫자형은 확인된 사실이 있을 때만.
- clipHint 에는 그 줄에 어울리는 장면을 스톡 영상 검색어로 쓸 수 있게 짧은 영어 키워드로 적으세요(예: "messy kitchen drawer").
- emphasis 에는 그 줄에 실제로 있는 핵심 단어 하나(자막 강조용)를 그대로 적으세요.
검색·노출 규칙:
- searchKeywords: 사람들이 이 문제를 겪을 때 실제로 검색창에 칠 말 3~5개(제품명·브랜드가 아니라 문제·상황, 예: "서랍 정리", "수저 정리 방법"). 맨 앞이 대표 키워드.
- 대표 키워드(또는 그 핵심 단어)를 훅이나 첫 공감 줄에 자연스럽게 넣어 첫 3초 안에 말하게 하세요.
- onScreenTitle: 첫 화면에 크게 띄울 12자 이내 제목(대표 키워드 포함, 예: "서랍 정리 끝").
- titles 3개: [검색 키워드] + [결과·호기심], 40자 이내, 키워드를 앞쪽에. 영상 내용과 다른 낚시 제목, "충격·경악·역대급·무조건" 같은 자극어 금지.
- hashtags: broad 1개(예: #살림템), mid 2개(예: #주방정리 #서랍정리), specific 1~2개(예: #수저정리). 관련 없는 인기 태그 금지, #쇼츠 불필요.
- cta 는 "필요할 때 보게 저장해 두고, 필요한 사람에게 보내 주세요" 류(저장·공유 유도). 링크 안내는 넣지 마세요(플랫폼마다 다름).
- commentKeyword 는 제품을 대표하는 2~4글자 한국어 단어.
신상품·사전예약 규칙:
- 확인된 사실에 "사전예약" 또는 "출시 예정"이 있으면 대사(해결 또는 마무리)와 제목에 그 말과 출고·출시일(사실에 있을 때만)을 넣으세요.
- 가격은 사실에 있을 때만, "영상 제작 시점 기준" 을 붙여서. 할인율·최저가 단정 금지.
- 브랜드가 협찬·추천·보증한 것처럼 말하지 마세요("공식 추천", "브랜드 협찬" 등). 브랜드명은 사실대로만.`;

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
  const hook = selectedHook(script);
  // 훅은 강조 단어가 따로 없으니, 대표 키워드의 단어가 들어 있으면 그걸 강조합니다.
  const hookEmphasis = keywordWords(script).find((w) => hook.includes(w));
  return [
    { text: hook, role: "HOOK", emphasis: hookEmphasis },
    ...script.problem.map((l) => ({ text: l.text, role: "PROBLEM" as const, emphasis: l.emphasis })),
    ...script.solution.map((l) => ({ text: l.text, role: "SOLUTION" as const, emphasis: l.emphasis })),
    { text: script.cta, role: "CTA" },
  ];
}

export function selectedHook(script: Script): string {
  return script.hooks[Math.min(script.hookIndex, script.hooks.length - 1)]!;
}

export function selectedHookType(script: Script): HookType | null {
  return script.hookTypes[Math.min(script.hookIndex, script.hooks.length - 1)] ?? null;
}

/** 대표 키워드를 이루는 단어들(2글자 이상) — "서랍 정리" → ["서랍", "정리"] */
export function keywordWords(script: Script): string[] {
  const main = script.searchKeywords[0];
  return main ? main.split(/\s+/).filter((w) => w.length >= 2) : [];
}

export function narrationLines(script: Script): string[] {
  return narration(script).map((l) => l.text);
}

export function placeholdersIn(script: Script): string[] {
  return narrationLines(script).filter((t) => t.includes(PLACEHOLDER));
}

/** 사전예약·출시 예정 상품인지 (pick 이 facts 에 넣는 표시) */
export const PREORDER_FACT = /사전\s?(예약|판매|주문)|출시\s?예정/;
/** 브랜드가 협찬·보증한 것처럼 보이는 표현 — 사실이 아니면 기만 광고 */
const ENDORSEMENT = /(공식\s?(추천|인증|파트너|협찬)|브랜드\s?(추천|협찬|제공)|협찬\s?받|제공\s?받)/;

/**
 * 신상·사전예약 규칙: 사전예약 상품이면 대사나 제목에 "사전예약/출시 예정"을 밝혀야 하고,
 * 가격을 말하면 "제작 시점 기준"을 붙여야 합니다(가격·출고일이 바뀔 수 있음).
 * 협찬받지 않았는데 협찬·공식 추천처럼 말하는 것도 막습니다.
 */
export function launchProblems(script: Script, facts: string[]): string[] {
  const out: string[] = [];
  const all = [...narrationLines(script), ...script.titles, script.onScreenTitle ?? ""];
  if (facts.some((f) => PREORDER_FACT.test(f)) && !all.some((t) => PREORDER_FACT.test(t))) {
    out.push("사전예약·출시 예정 상품인데 대사나 제목에 '사전예약' 또는 '출시 예정'이 없어요(바로 살 수 있는 것처럼 보이면 안 됨).");
  }
  const priceLine = all.find((t) => /\d[\d,]*\s?(원|만\s?원)/.test(t) && !/(기준|변동)/.test(t));
  if (priceLine) out.push(`가격을 말할 땐 '제작 시점 기준, 변동 가능'을 붙이세요: "${priceLine}"`);
  const endorse = all.find((t) => ENDORSEMENT.test(t));
  if (endorse && !facts.some((f) => /협찬|제공받/.test(f))) out.push(`브랜드가 협찬·보증한 것처럼 보이는 표현이 있어요: "${endorse}"`);
  return out;
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
    jsonSchema: z.toJSONSchema(ScriptCore.omit({ hookIndex: true }), { io: "input" }),
  });
  const raw = res.structured ?? extractJson(res.text);
  return ScriptSchema.parse(raw);
}

function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("대본 응답에서 JSON 을 찾지 못했어요.");
  return JSON.parse(m[0]);
}
