import { createHmac } from "node:crypto";

/**
 * 네이버 검색광고 키워드도구(공식 API) — 월간 검색량으로 검색 키워드를 고릅니다.
 * jk-biz(src/lib/topics/sources.ts)와 같은 키를 씁니다: NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID
 * (searchad.naver.com → 도구 → API 사용 관리에서 무료 발급)
 */
export type NaverAdCred = { key: string; secret: string; customer: string };
export type KeywordVolume = { keyword: string; monthlyPc: number; monthlyMobile: number; compIdx: string };

export function naverAdCred(env: NodeJS.ProcessEnv = process.env): NaverAdCred | null {
  const key = env.NAVER_AD_API_KEY?.trim();
  const secret = env.NAVER_AD_SECRET_KEY?.trim();
  const customer = env.NAVER_AD_CUSTOMER_ID?.trim();
  return key && secret && customer ? { key, secret, customer } : null;
}

export const KEYWORD_PATH = "/keywordstool";

export function signature(secret: string, timestamp: string, method = "GET", path = KEYWORD_PATH): string {
  return createHmac("sha256", secret).update(`${timestamp}.${method}.${path}`).digest("base64");
}

/** "< 10" 같은 값은 5로 */
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.includes("<") ? 5 : Number(v.replace(/,/g, "")) || 0;
  return 0;
}

/** 힌트 키워드와 연관 키워드의 월간 검색량 (힌트는 공백·특수문자 없이 5개씩) */
export async function keywordVolumes(hints: string[], cred: NaverAdCred, f: typeof fetch = fetch, now = () => Date.now()): Promise<KeywordVolume[]> {
  const clean = [...new Set(hints.map((h) => h.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean))];
  const out: KeywordVolume[] = [];
  for (let i = 0; i < clean.length; i += 5) {
    const ts = String(now());
    const url = `https://api.searchad.naver.com${KEYWORD_PATH}?hintKeywords=${encodeURIComponent(clean.slice(i, i + 5).join(","))}&showDetail=1`;
    const res = await f(url, { headers: { "X-Timestamp": ts, "X-API-KEY": cred.key, "X-Customer": cred.customer, "X-Signature": signature(cred.secret, ts) } });
    if (!res.ok) throw new Error(`네이버 검색광고 API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { keywordList?: Record<string, unknown>[] };
    for (const k of data.keywordList ?? []) {
      out.push({ keyword: String(k.relKeyword), monthlyPc: toNum(k.monthlyPcQcCnt), monthlyMobile: toNum(k.monthlyMobileQcCnt), compIdx: String(k.compIdx ?? "") });
    }
  }
  return out;
}

/**
 * 후보 정리: 모바일 검색량 순. 쇼츠는 모바일에서 보므로 모바일 검색량을 기준으로 합니다.
 * 힌트와 관련 없는 연관어가 많이 섞이므로, 힌트의 단어를 하나라도 포함한 것만 남깁니다.
 */
export function rankKeywords(volumes: KeywordVolume[], hints: string[], limit = 10): KeywordVolume[] {
  const words = [...new Set(hints.flatMap((h) => h.split(/\s+/)).filter((w) => w.length >= 2))];
  const seen = new Set<string>();
  return volumes
    .filter((v) => words.some((w) => v.keyword.includes(w)))
    .filter((v) => (seen.has(v.keyword) ? false : (seen.add(v.keyword), true)))
    .sort((a, b) => b.monthlyMobile - a.monthlyMobile)
    .slice(0, limit);
}
