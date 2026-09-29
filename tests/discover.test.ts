import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getCandidate, listCandidates, openDb, setCandidateStatus, upsertCandidate } from "../src/db.js";
import { categoryMatches } from "../src/product/score.js";
import { authorization, BASE_PATH, CoupangClient, GATEWAY, signedDate } from "../src/research/coupang.js";
import { momentumOf, trendMomentum } from "../src/research/datalab.js";
import { dedupe, fromCoupang, fromLaunches, scoreCandidate, type Candidate } from "../src/research/discover.js";
import { isPreorderTitle, parseRss, rssUrl } from "../src/research/launches.js";
import { launchProblems, ScriptSchema } from "../src/script/generate.js";
import { sample } from "./fixtures.js";

describe("쿠팡파트너스 API", () => {
  const cred = { accessKey: "ak", secretKey: "sk" };
  const now = new Date(Date.UTC(2026, 8, 29, 3, 4, 5));

  it("signed-date 는 UTC yyMMddTHHmmssZ", () => {
    expect(signedDate(now)).toBe("260929T030405Z");
  });

  it("서명 대상 = 시각 + 메서드 + 경로 + 쿼리(물음표 없이), hex", () => {
    const path = `${BASE_PATH}/products/bestcategories/1013?limit=20`;
    const expected = createHmac("sha256", "sk").update(`260929T030405ZGET${BASE_PATH}/products/bestcategories/1013limit=20`).digest("hex");
    expect(authorization(cred, "get", path, now)).toBe(`CEA algorithm=HmacSHA256, access-key=ak, signed-date=260929T030405Z, signature=${expected}`);
  });

  it("베스트·검색 응답 파싱, 오류 코드는 예외", async () => {
    const replies: unknown[] = [
      { rCode: "0", data: [{ productId: 11, productName: "칸막이", productPrice: 12900, productImage: "https://img/1.jpg", productUrl: "https://link.coupang.com/a/1", isRocket: true }] },
      { rCode: "0", data: { landingUrl: "x", productData: [{ productId: 22, productName: "청소기", productPrice: 199000, productImage: "i", productUrl: "u", categoryName: "가전디지털" }] } },
      { rCode: "400", rMessage: "limit" },
    ];
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(replies.shift()));
    }) as typeof fetch;
    const c = new CoupangClient(cred, f, async () => {});
    const best = await c.bestCategory(1013, 20);
    expect(best[0]).toMatchObject({ productId: "11", rank: 1, categoryName: "주방용품", isRocket: true });
    expect(urls[0]).toBe(`${GATEWAY}${BASE_PATH}/products/bestcategories/1013?limit=20`);
    expect((await c.search("무선 청소기"))[0]).toMatchObject({ productId: "22", categoryName: "가전디지털" });
    await expect(c.goldbox()).rejects.toThrow(/limit/);
  });
});

describe("데이터랩 상승률", () => {
  it("최근 7일 ÷ 이전 평균", () => {
    expect(momentumOf([...Array(21).fill(10), ...Array(7).fill(20)])).toBeCloseTo(2);
    expect(momentumOf([1, 2])).toBe(1);
  });

  it("API HUB 헤더로 호출, 실패 묶음은 건너뜀", async () => {
    let headers: Record<string, string> = {};
    const f = (async (_u: string, init?: RequestInit) => {
      headers = init!.headers as Record<string, string>;
      return new Response(JSON.stringify({ results: [{ title: "무선 청소기", data: [...Array(21).fill({ ratio: 10 }), ...Array(7).fill({ ratio: 15 })] }] }));
    }) as typeof fetch;
    const m = await trendMomentum(["무선 청소기"], { id: "i", secret: "s" }, f, new Date("2026-09-29"));
    expect(m["무선 청소기"]).toBeCloseTo(1.5);
    expect(headers["X-NCP-APIGW-API-KEY-ID"]).toBe("i");
  });
});

describe("신상·사전예약 뉴스", () => {
  const xml = `<rss><channel>
    <item><title>OO전자, 무선 물걸레청소기 신제품 사전예약 시작 - 한국경제</title><link>https://news.google.com/a</link><pubDate>Mon, 28 Sep 2026 01:00:00 GMT</pubDate><source url="x">한국경제</source></item>
    <item><title><![CDATA[△△ 식품 3분기 실적 발표 &amp; 전망 - 연합]]></title><link>https://news.google.com/b</link><pubDate>Sun, 27 Sep 2026 01:00:00 GMT</pubDate><source url="y">연합</source></item>
  </channel></rss>`;

  it("RSS 파싱: 언론사 꼬리 제거, CDATA·엔티티 해제", () => {
    const items = parseRss(xml);
    expect(items[0]).toMatchObject({ title: "OO전자, 무선 물걸레청소기 신제품 사전예약 시작", source: "한국경제", link: "https://news.google.com/a" });
    expect(items[1]!.title).toBe("△△ 식품 3분기 실적 발표 & 전망");
    expect(isPreorderTitle(items[0]!.title)).toBe(true);
    expect(rssUrl("사전예약 가전")).toContain("when%3A7d");
  });

  it("관련 있는 것만 후보로, 사전예약 표시", () => {
    const news = parseRss(xml);
    const c = fromLaunches(news, [
      { index: 0, relevant: true, brand: "OO전자", product: "무선 물걸레청소기", category: "가전", isPreorder: false, launchDate: "2026-10-05" },
      { index: 1, relevant: false, brand: null, product: "실적", category: null, isPreorder: false, launchDate: null },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ source: "LAUNCH", name: "OO전자 무선 물걸레청소기", isPreorder: true, partnerUrl: null, newsDate: "2026-09-28" });
  });
});

describe("점수·중복", () => {
  const today = new Date("2026-09-29");
  const p = (id: number, price: number, rank: number, category = "주방용품") => ({ productId: String(id), productName: `상품${id}`, productPrice: price, productImage: "i", productUrl: "u", categoryName: category, rank });

  it("같은 상품은 하나로(좋은 순위, 골드박스 표시 유지)", () => {
    const d = dedupe([...fromCoupang([p(1, 20000, 5)], "GOLDBOX"), ...fromCoupang([p(1, 20000, 2)], "BEST")]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ rank: 2, source: "GOLDBOX" });
  });

  it("수요·가격대·상승·신기함·문제 해결을 더하고 근거를 남김", () => {
    const [c] = fromCoupang([p(1, 25000, 1)], "BEST");
    const s = scoreCandidate({ ...c!, momentum: 1.5, novelty: 2, solves: "수저 뒤섞임" }, today);
    expect(s.score).toBeCloseTo(3 + 1 + 1 + 2 + 1, 5);
    expect(s.reasons).toEqual(["베스트 1위", "최근 7일 검색 +50%", "적정 가격대", "신기함", "해결: 수저 뒤섞임"]);
  });

  it("사전예약·출시 임박 가산, 채널 분야 밖은 감점", () => {
    const launch: Candidate = { ...fromCoupang([p(2, 300000, 99, "가전디지털")], "BEST")[0]!, rank: null, source: "LAUNCH", isPreorder: true, launchDate: "2026-10-03" };
    const s = scoreCandidate(launch, today);
    expect(s.reasons).toContain("사전예약");
    expect(s.reasons).toContain("출시 D-4");
    expect(scoreCandidate({ ...launch, category: "여성패션" }, today).score).toBeLessThan(0);
  });

  it("넓은 콘셉트의 허용 분야", () => {
    for (const c of ["주방용품", "생활용품", "가전디지털", "스포츠/레저", "반려동물용품"]) expect(categoryMatches(c)).toBe(true);
    expect(categoryMatches("여성패션")).toBe(false);
  });
});

describe("후보 저장", () => {
  it("다시 발굴돼도 고름·건너뜀 상태는 유지, 점수 순 목록", () => {
    const db = openDb(":memory:");
    upsertCandidate(db, "coupang:1", { name: "a" }, 3);
    upsertCandidate(db, "coupang:2", { name: "b" }, 5);
    const [first] = listCandidates<{ name: string }>(db);
    expect(first!.data.name).toBe("b");
    setCandidateStatus(db, first!.id, "PICKED", 7);
    upsertCandidate(db, "coupang:2", { name: "b2" }, 6);
    const again = getCandidate<{ name: string }>(db, first!.id)!;
    expect(again).toMatchObject({ status: "PICKED", shortId: 7, score: 6, data: { name: "b2" } });
    expect(listCandidates(db).map((r) => r.key)).toEqual(["coupang:1"]);
  });
});

describe("신상·사전예약 대본 규칙", () => {
  it("사전예약 상품인데 대사·제목에 사전예약이 없으면 차단", () => {
    expect(launchProblems(sample, ["사전예약 상품"]).join()).toMatch(/사전예약/);
    const ok = ScriptSchema.parse({ ...sample, cta: "사전예약은 10월 5일까지, 저장해 두세요" });
    expect(launchProblems(ok, ["사전예약 상품"])).toEqual([]);
  });

  it("가격은 제작 시점 기준을 붙여야 함", () => {
    const priced = ScriptSchema.parse({ ...sample, cta: "지금 12,900원이에요" });
    expect(launchProblems(priced, []).join()).toMatch(/제작 시점 기준/);
    const okPrice = ScriptSchema.parse({ ...sample, cta: "제작 시점 기준 12,900원" });
    expect(launchProblems(okPrice, [])).toEqual([]);
  });

  it("협찬받지 않았는데 공식 추천처럼 말하면 차단", () => {
    const e = ScriptSchema.parse({ ...sample, titles: ["브랜드 추천 서랍 정리템"] });
    expect(launchProblems(e, []).join()).toMatch(/협찬·보증/);
  });
});
