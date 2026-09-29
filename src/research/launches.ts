/**
 * 신상품·사전예약 소식 — 구글 뉴스 RSS 검색(공개 피드). 제목·링크·날짜·언론사만 쓰고 기사 본문은 저장하지 않습니다.
 */
export type NewsItem = { title: string; link: string; pubDate: string; source: string };

/** 기본 검색어: 사전예약·출시 소식 × 채널 분야 */
export const LAUNCH_QUERIES = ["사전예약 가전", "사전예약 생활용품", "신제품 출시 주방", "신제품 출시 소형가전", "출시 예정 생활가전", "사전판매 신제품"];

export function rssUrl(query: string, days = 7): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${days}d`)}&hl=ko&gl=KR&ceid=KR:ko`;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

export function parseRss(xml: string): NewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const get = (tag: string) => decode(m[1]!.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
    const source = get("source");
    // 구글 뉴스 제목은 "제목 - 언론사" 형식
    const title = get("title").replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    return { title, link: get("link"), pubDate: get("pubDate"), source };
  });
}

export async function fetchLaunchNews(queries = LAUNCH_QUERIES, f: typeof fetch = fetch): Promise<NewsItem[]> {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const q of queries) {
    const res = await f(rssUrl(q), { headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null);
    if (!res?.ok) continue;
    for (const item of parseRss(await res.text())) {
      const key = item.title.replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** 제목만 보고도 사전예약인지 알 수 있는 경우 */
export const isPreorderTitle = (t: string) => /사전\s?(예약|판매|주문)/.test(t);
