/**
 * 제품 선정 기준 (여러 쇼핑쇼츠 강의가 공통으로 꼽는 4가지)
 * 1. 신기한가 — 다이소·마트·로켓배송에서 흔히 보이지 않는 것
 * 2. 문제를 해결하는가 — "무엇을" 해결하는지 한 줄로 말할 수 있어야 함
 * 3. 시즌·트렌드에 맞는가
 * 4. 채널 카테고리와 맞는가 (카테고리는 하나로 고정)
 */
export type Scores = { novel: boolean; solves: string | null; season: boolean; categoryMatch: boolean; passed: number };

export const DEFAULT_CATEGORY = "주방·살림";

export function channelCategory(): string {
  return process.env.SSS_CATEGORY?.trim() || DEFAULT_CATEGORY;
}

/** 카테고리 이름 비교 — "주방", "살림", "주방·살림" 처럼 부분 일치도 같은 채널로 봅니다. */
export function categoryMatches(productCategory: string | null | undefined, channel = channelCategory()): boolean {
  if (!productCategory) return false;
  const norm = (s: string) => s.replace(/\s/g, "");
  const parts = channel.split(/[·,/|]/).map(norm).filter(Boolean);
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
  if (!s.categoryMatch) out.push(`채널 카테고리(${channelCategory()})`);
  return out;
}
