/**
 * 제품 선정 기준 (여러 쇼핑쇼츠 강의가 공통으로 꼽는 4가지)
 * 1. 신기한가 — 다이소·마트·로켓배송에서 흔히 보이지 않는 것
 * 2. 문제를 해결하는가 — "무엇을" 해결하는지 한 줄로 말할 수 있어야 함
 * 3. 시즌·트렌드에 맞는가
 * 4. 채널 콘셉트의 허용 분야 안인가 (콘셉트는 넓게 하나, 톤은 일관되게)
 */
export type Scores = { novel: boolean; solves: string | null; season: boolean; categoryMatch: boolean; passed: number };

/** 채널 콘셉트(이름·소개에 쓰는 한 줄) */
export const DEFAULT_CATEGORY = "요즘 뜨는 생활템·신상템";
/** 콘셉트 안에서 다루는 분야 — 쿠팡 카테고리 이름(주방용품·생활용품·가전디지털·스포츠/레저 등)과 부분 일치로 비교 */
export const DEFAULT_ALLOWED = ["주방", "생활", "살림", "청소", "수납", "인테리어", "가전", "디지털", "반려", "캠핑", "스포츠", "레저"];

export function channelCategory(): string {
  return process.env.SSS_CATEGORY?.trim() || DEFAULT_CATEGORY;
}

export function allowedCategories(): string[] {
  const env = process.env.SSS_ALLOWED?.split(/[,·/|]/).map((s) => s.trim()).filter(Boolean);
  return env?.length ? env : DEFAULT_ALLOWED;
}

/** 분야 비교 — 부분 일치("주방용품" ⊃ "주방"). allowed 가 문자열이면 ·,/| 로 나눕니다. */
export function categoryMatches(productCategory: string | null | undefined, allowed: string | string[] = allowedCategories()): boolean {
  if (!productCategory) return false;
  const norm = (s: string) => s.replace(/\s/g, "");
  const parts = (typeof allowed === "string" ? allowed.split(/[·,/|]/) : allowed).map(norm).filter(Boolean);
  const p = norm(productCategory);
  return parts.some((c) => p.includes(c) || c.includes(p));
}

export function evaluate(input: { novel: boolean; solves?: string | null; season: boolean; categoryMatch: boolean }): Scores {
  const solves = input.solves?.trim() ? input.solves.trim() : null;
  const passed = [input.novel, !!solves, input.season, input.categoryMatch].filter(Boolean).length;
  return { novel: input.novel, solves, season: input.season, categoryMatch: input.categoryMatch, passed };
}

export function failedCriteria(s: Scores): string[] {
  const out: string[] = [];
  if (!s.novel) out.push("신기함(흔히 보이는 제품)");
  if (!s.solves) out.push("문제 해결(무엇을 해결하는지 불명확)");
  if (!s.season) out.push("시즌·트렌드");
  if (!s.categoryMatch) out.push(`채널 분야(${allowedCategories().join("·")})`);
  return out;
}
