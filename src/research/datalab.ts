/**
 * 네이버 데이터랩 검색어 트렌드(공식, NAVER API HUB) — 기간별로 뜨는 키워드.
 * jk-biz(src/lib/topics/sources.ts naverTrendMomentum)와 같은 키·경로: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
 * (2026-06 개발자센터 → API HUB 이전: X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY 헤더)
 */
export const API_HUB = "https://naverapihub.apigw.ntruss.com";
export const TREND_PATH = "/search-trend/v1/search";

export type NaverOpenCred = { id: string; secret: string };

export function naverOpenCred(env: NodeJS.ProcessEnv = process.env): NaverOpenCred | null {
  const id = env.NAVER_CLIENT_ID?.trim();
  const secret = env.NAVER_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 최근 7일 평균 ÷ 그 전 21일 평균 (1.0 = 보합, 2.0 = 두 배로 뜸). 일 단위 비율 목록에서 계산 */
export function momentumOf(daily: number[]): number {
  if (daily.length < 8) return 1;
  const recent = avg(daily.slice(-7));
  const before = avg(daily.slice(0, -7));
  return before > 0 ? recent / before : recent > 0 ? 2 : 1;
}

/** 키워드별 최근 7일 상승률 (5개씩 묶어 호출, 한 묶음 실패는 건너뜀) */
export async function trendMomentum(keywords: string[], cred: NaverOpenCred, f: typeof fetch = fetch, today = new Date()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const end = new Date(today.getTime() - 86_400_000);
  const start = new Date(today.getTime() - 28 * 86_400_000);
  const uniq = [...new Set(keywords.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 5) {
    const batch = uniq.slice(i, i + 5);
    const res = await f(`${API_HUB}${TREND_PATH}`, {
      method: "POST",
      headers: { "X-NCP-APIGW-API-KEY-ID": cred.id, "X-NCP-APIGW-API-KEY": cred.secret, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), timeUnit: "date", keywordGroups: batch.map((k) => ({ groupName: k, keywords: [k] })) }),
    }).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json()) as { results?: { title: string; data: { ratio: number }[] }[] };
    for (const r of data.results ?? []) out[r.title] = momentumOf(r.data.map((d) => d.ratio));
  }
  return out;
}
