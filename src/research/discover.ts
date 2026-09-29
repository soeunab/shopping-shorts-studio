import { z } from "zod";
import { runClaudeCode } from "../llm/claudeCode.js";
import { categoryMatches } from "../product/score.js";
import type { CoupangProduct } from "./coupang.js";
import { isPreorderTitle, type NewsItem } from "./launches.js";

/**
 * 상품 후보 발굴 — 매출이 가장 잘 나는 조합: 트렌드 수요 × 신기함·문제 해결 × 적정 가격대.
 * 점수 내역(reasons)을 함께 남겨 왜 뽑혔는지 보이게 합니다.
 */
export type CandidateSource = "GOLDBOX" | "BEST" | "LAUNCH";

export type Candidate = {
  /** 중복 제거 키: coupang:<productId> 또는 news:<제목> */
  key: string;
  source: CandidateSource;
  name: string;
  price: number | null;
  image: string | null;
  /** 쿠팡파트너스 링크 (뉴스 후보는 고를 때 검색으로 채움) */
  partnerUrl: string | null;
  category: string | null;
  rank: number | null;
  isRocket?: boolean;
  newsTitle?: string | null;
  newsUrl?: string | null;
  newsDate?: string | null;
  brand?: string | null;
  isPreorder: boolean;
  launchDate: string | null;
  /** 사람들이 칠 검색어 (Claude 1차 판정) */
  keyword: string | null;
  /** 최근 7일 검색 상승률 (1.0 = 보합) */
  momentum: number | null;
  /** 신기함 0~2 (Claude 1차 판정, 확정은 사람이 score 로) */
  novelty: number | null;
  solves: string | null;
  score: number;
  reasons: string[];
};

const base = (c: Partial<Candidate> & Pick<Candidate, "key" | "source" | "name">): Candidate => ({
  price: null,
  image: null,
  partnerUrl: null,
  category: null,
  rank: null,
  isPreorder: false,
  launchDate: null,
  keyword: null,
  momentum: null,
  novelty: null,
  solves: null,
  score: 0,
  reasons: [],
  ...c,
});

export function fromCoupang(products: CoupangProduct[], source: "GOLDBOX" | "BEST"): Candidate[] {
  return products.map((p) =>
    base({
      key: `coupang:${p.productId}`,
      source,
      name: p.productName,
      price: p.productPrice || null,
      image: p.productImage || null,
      partnerUrl: p.productUrl || null,
      category: p.categoryName ?? null,
      rank: p.rank ?? null,
      isRocket: p.isRocket,
    }),
  );
}

export type LaunchInfo = { index: number; relevant: boolean; brand: string | null; product: string; category: string | null; isPreorder: boolean; launchDate: string | null };

export function fromLaunches(news: NewsItem[], infos: LaunchInfo[]): Candidate[] {
  return infos
    .filter((i) => i.relevant && news[i.index])
    .map((i) => {
      const n = news[i.index]!;
      return base({
        key: `news:${(i.brand ?? "") + i.product}`.replace(/\s+/g, ""),
        source: "LAUNCH",
        name: [i.brand, i.product].filter(Boolean).join(" "),
        category: i.category,
        brand: i.brand,
        isPreorder: i.isPreorder || isPreorderTitle(n.title),
        launchDate: i.launchDate,
        newsTitle: n.title,
        newsUrl: n.link,
        newsDate: n.pubDate ? new Date(n.pubDate).toISOString().slice(0, 10) : null,
      });
    });
}

/** 같은 상품이 골드박스·베스트에 같이 나오면 하나로(순위 좋은 쪽 유지) */
export function dedupe(cands: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = map.get(c.key);
    if (!prev || (c.rank ?? 99) < (prev.rank ?? 99)) map.set(c.key, prev ? { ...c, source: prev.source === "GOLDBOX" ? "GOLDBOX" : c.source } : c);
  }
  return [...map.values()];
}

const daysBetween = (a: string, b: Date) => Math.round((new Date(a).getTime() - b.getTime()) / 86_400_000);

/** 점수 = 수요 + 상승 + 가격대 + 시의성 + 신기함·문제 해결 (채널 분야 밖이면 크게 감점) */
export function scoreCandidate(c: Candidate, today = new Date(), allowed?: string | string[]): Candidate {
  let score = 0;
  const reasons: string[] = [];
  if (c.rank) {
    const d = Math.max(0, 1 - (c.rank - 1) / 20) * 3;
    score += d;
    reasons.push(`${c.source === "GOLDBOX" ? "골드박스" : "베스트"} ${c.rank}위`);
  }
  if (c.source === "GOLDBOX") score += 0.5;
  if (c.momentum !== null && c.momentum > 1.05) {
    score += Math.min(2, (c.momentum - 1) * 2);
    reasons.push(`최근 7일 검색 +${Math.round((c.momentum - 1) * 100)}%`);
  }
  if (c.price) {
    if (c.price >= 10_000 && c.price <= 100_000) (score += 1), reasons.push("적정 가격대");
    else if (c.price > 100_000 && c.price <= 500_000) (score += 0.7), reasons.push("고가(장바구니 효과)");
    else score += 0.2;
  }
  if (c.isPreorder) (score += 1.5), reasons.push("사전예약");
  if (c.launchDate) {
    const d = daysBetween(c.launchDate, today);
    if (d >= -7 && d <= 7) (score += 1), reasons.push(d >= 0 ? `출시 D-${d}` : `출시 ${-d}일 지남`);
  } else if (c.source === "LAUNCH" && c.newsDate && daysBetween(c.newsDate, today) >= -3) {
    score += 0.5;
    reasons.push("최근 소식");
  }
  if (c.novelty !== null) {
    score += c.novelty;
    if (c.novelty >= 2) reasons.push("신기함");
  }
  if (c.solves) (score += 1), reasons.push(`해결: ${c.solves}`);
  if (!categoryMatches(c.category, allowed)) (score -= 5), reasons.push(`채널 분야 밖(${c.category ?? "분야 미상"})`);
  return { ...c, score: +score.toFixed(2), reasons };
}

// ─── Claude 구독으로 1차 판정 ───────────────────────────────────────────

const EnrichSchema = z.object({
  items: z.array(z.object({ index: z.number().int(), keyword: z.string().max(20), novelty: z.number().int().min(0).max(2), solves: z.string().max(40).nullable() })),
});

/** 상품명만 보고: 사람들이 칠 검색어, 신기함(0~2), 해결하는 불편 한 줄 — 모르면 null, 지어내지 않음 */
export async function enrich(cands: Candidate[]): Promise<Candidate[]> {
  if (!cands.length) return cands;
  const list = cands.map((c, i) => `${i}. ${c.name} (${c.category ?? "분야 미상"})`).join("\n");
  const res = await runClaudeCode({
    system: `쇼핑 쇼츠 상품 후보를 1차로 분류합니다. 상품명과 분야만 보고 판단하고, 모르는 것은 지어내지 마세요.
- keyword: 이 상품이 필요한 사람이 검색창에 칠 2~3단어 한국어 검색어(브랜드·모델명 제외, 예: "무선 청소기", "수저 정리함").
- novelty: 0=다이소·마트에서 흔함, 1=조금 새로움, 2="이런 게 있어?" 싶은 신기한 제품.
- solves: 해결하는 불편을 한 줄로. 상품명만으로 알 수 없으면 null.`,
    prompt: `후보:\n${list}\n\nJSON 으로 모든 후보(index 포함)를 분류하세요.`,
    jsonSchema: z.toJSONSchema(EnrichSchema),
  });
  const parsed = EnrichSchema.parse(res.structured ?? JSON.parse(res.text.match(/\{[\s\S]*\}/)?.[0] ?? "{}"));
  return cands.map((c, i) => {
    const e = parsed.items.find((x) => x.index === i);
    return e ? { ...c, keyword: e.keyword || null, novelty: e.novelty, solves: e.solves } : c;
  });
}

const LaunchSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      relevant: z.boolean(),
      brand: z.string().nullable(),
      product: z.string(),
      category: z.string().nullable(),
      isPreorder: z.boolean(),
      launchDate: z.string().nullable(),
    }),
  ),
});

/** 뉴스 제목 → 브랜드·제품·분야·사전예약·출시일 (제목에 없는 정보는 null) */
export async function extractLaunches(news: NewsItem[], concept: string): Promise<LaunchInfo[]> {
  if (!news.length) return [];
  const list = news.map((n, i) => `${i}. ${n.title} (${n.pubDate.slice(0, 16)})`).join("\n");
  const res = await runClaudeCode({
    system: `뉴스 제목에서 소비자가 살 수 있는 신제품·사전예약 상품을 뽑습니다. 제목에 없는 정보는 null 로 두고 지어내지 마세요.
- relevant: 채널 콘셉트("${concept}")에 맞는 소비재 신제품·사전예약이면 true. 기업 실적·서비스·자동차·부동산·금융·식음료 매장 메뉴는 false.
- product: 제품명(모델명이 있으면 포함), brand: 브랜드, category: 주방/생활/청소/수납/가전/디지털/반려/캠핑 중 하나 또는 null.
- isPreorder: 사전예약·사전판매면 true. launchDate: 제목에 출시·출고일이 있으면 YYYY-MM-DD, 없으면 null.`,
    prompt: `뉴스 제목:\n${list}\n\nJSON 으로 모든 항목(index 포함)을 분류하세요.`,
    jsonSchema: z.toJSONSchema(LaunchSchema),
  });
  return LaunchSchema.parse(res.structured ?? JSON.parse(res.text.match(/\{[\s\S]*\}/)?.[0] ?? "{}")).items;
}
