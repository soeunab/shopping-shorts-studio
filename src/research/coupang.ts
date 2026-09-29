import { createHmac } from "node:crypto";

/**
 * 쿠팡파트너스 Open API (공식) — 골드박스·카테고리 베스트·검색·딥링크.
 * 키: 파트너스 센터 → 추가 기능 → Open API 에서 발급(발급 조건은 파트너스 센터 확인) → COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY
 * 호출 제한: 검색은 1시간 10회. 제한을 넘기면 즉시 차단될 수 있어 호출 사이에 간격을 둡니다.
 * 쿠팡 페이지를 직접 긁는 방식은 약관 위반이라 쓰지 않습니다.
 */
export const GATEWAY = "https://api-gateway.coupang.com";
export const BASE_PATH = "/v2/providers/affiliate_open_api/apis/openapi";

/** 카테고리 베스트용 쿠팡 카테고리 ID (파트너스 문서 기준) */
export const COUPANG_CATEGORIES: Record<number, string> = {
  1013: "주방용품",
  1014: "생활용품",
  1015: "홈인테리어",
  1016: "가전디지털",
  1017: "스포츠/레저",
  1018: "자동차용품",
  1029: "반려동물용품",
};

export type CoupangCred = { accessKey: string; secretKey: string };
export type CoupangProduct = {
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  /** 파트너스 링크(수익이 잡히는 링크) */
  productUrl: string;
  categoryName?: string;
  isRocket?: boolean;
  rank?: number;
};

export function coupangCred(env: NodeJS.ProcessEnv = process.env): CoupangCred | null {
  const accessKey = env.COUPANG_ACCESS_KEY?.trim();
  const secretKey = env.COUPANG_SECRET_KEY?.trim();
  return accessKey && secretKey ? { accessKey, secretKey } : null;
}

/** yyMMdd'T'HHmmss'Z' (UTC) */
export function signedDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).slice(-2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Authorization 헤더: 서명 대상은 시각 + 메서드 + 경로 + 쿼리(물음표 없이) */
export function authorization(cred: CoupangCred, method: string, pathWithQuery: string, now = new Date()): string {
  const [path, query = ""] = pathWithQuery.split("?");
  const datetime = signedDate(now);
  const signature = createHmac("sha256", cred.secretKey).update(`${datetime}${method.toUpperCase()}${path}${query}`).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${cred.accessKey}, signed-date=${datetime}, signature=${signature}`;
}

function toProduct(raw: Record<string, unknown>, fallbackCategory?: string): CoupangProduct {
  return {
    productId: String(raw.productId),
    productName: String(raw.productName ?? ""),
    productPrice: Number(raw.productPrice ?? 0),
    productImage: String(raw.productImage ?? ""),
    productUrl: String(raw.productUrl ?? ""),
    categoryName: (raw.categoryName as string | undefined) ?? fallbackCategory,
    isRocket: Boolean(raw.isRocket),
    rank: raw.rank === undefined ? undefined : Number(raw.rank),
  };
}

export class CoupangClient {
  constructor(
    private readonly cred: CoupangCred,
    private readonly f: typeof fetch = fetch,
    private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    private readonly gapMs = 1500,
  ) {}

  private async call(method: "GET" | "POST", pathWithQuery: string, body?: unknown): Promise<unknown> {
    const full = `${BASE_PATH}${pathWithQuery}`;
    const res = await this.f(`${GATEWAY}${full}`, {
      method,
      headers: { Authorization: authorization(this.cred, method, full), "Content-Type": "application/json;charset=UTF-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { rCode?: string; rMessage?: string; data?: unknown };
    if (!res.ok || (json.rCode !== undefined && json.rCode !== "0")) throw new Error(`쿠팡파트너스 API ${res.status}: ${json.rMessage ?? "오류"}`);
    await this.sleep(this.gapMs);
    return json.data;
  }

  /** 골드박스(오늘의 특가) */
  async goldbox(): Promise<CoupangProduct[]> {
    const data = (await this.call("GET", "/products/goldbox")) as Record<string, unknown>[] | undefined;
    return (data ?? []).map((p, i) => ({ ...toProduct(p), rank: i + 1 }));
  }

  /** 카테고리별 베스트 */
  async bestCategory(categoryId: number, limit = 20): Promise<CoupangProduct[]> {
    const data = (await this.call("GET", `/products/bestcategories/${categoryId}?limit=${limit}`)) as Record<string, unknown>[] | undefined;
    return (data ?? []).map((p, i) => toProduct({ rank: i + 1, ...p }, COUPANG_CATEGORIES[categoryId]));
  }

  /** 상품 검색 — 1시간 10회 제한이 있어 필요할 때만(후보를 고를 때) 씁니다. */
  async search(keyword: string, limit = 5): Promise<CoupangProduct[]> {
    const data = (await this.call("GET", `/products/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`)) as { productData?: Record<string, unknown>[] } | undefined;
    return (data?.productData ?? []).map((p) => toProduct(p));
  }

  /** 쿠팡 상품 URL → 파트너스 링크 */
  async deeplink(urls: string[]): Promise<{ originalUrl: string; shortenUrl: string }[]> {
    const data = (await this.call("POST", "/v1/deeplink", { coupangUrls: urls })) as { originalUrl: string; shortenUrl: string }[] | undefined;
    return data ?? [];
  }
}
