import { describe, expect, it } from "vitest";
import { groupReport, MIN_SAMPLE, type ReportRow } from "../src/db.js";
import { buildAss, emphasize, TITLE_CARD_SECONDS } from "../src/media/subtitles.js";
import { keywordVolumes, rankKeywords, signature } from "../src/research/naver.js";
import { allHashtags, narration, ScriptSchema, selectedHookType, type Script } from "../src/script/generate.js";
import { containsKeyword, keywordPosition, lintMetadata } from "../src/script/seo.js";
import { legacyRaw, sample } from "./fixtures.js";

describe("대본 스키마", () => {
  it("해시태그 정규화(# 붙이고 공백 제거)와 구조", () => {
    expect(allHashtags(sample)).toEqual(["#살림템", "#주방정리", "#서랍정리", "#수저정리"]);
  });

  it("옛 script.json(해시태그 배열)도 읽힘, #쇼츠는 버림", () => {
    const s = ScriptSchema.parse(legacyRaw);
    expect(s.hashtags).toEqual({ broad: ["#살림템"], mid: ["#주방정리", "#서랍정리"], specific: ["#수저정리"] });
    expect(s.searchKeywords).toEqual([]);
    expect(s.hookTypes).toEqual([]);
  });

  it("고른 훅의 유형, 훅 강조는 대표 키워드 단어", () => {
    expect(selectedHookType(sample)).toBe("반전");
    const n = narration(sample);
    expect(n[0]!.emphasis).toBe("서랍");
    expect(n[1]!.emphasis).toBe("수저");
  });
});

describe("메타데이터 점검", () => {
  it("잘 만든 대본은 경고 없음", () => {
    expect(lintMetadata(sample)).toEqual([]);
  });

  it("키워드 포함 판단은 띄어쓰기 무시, 단어가 모두 있으면 포함", () => {
    expect(containsKeyword("서랍정리 끝", "서랍 정리")).toBe(true);
    expect(containsKeyword("정리 안 되는 서랍", "서랍 정리")).toBe(true);
    expect(containsKeyword("수저가 섞여요", "서랍 정리")).toBe(false);
    expect(keywordPosition("이거 하나면 끝나는 서랍 정리", "서랍 정리")).toBe(8);
    expect(keywordPosition("서랍 정리 이거 하나면 끝", "서랍 정리")).toBe(0);
  });

  it("문제 있는 대본은 각각 경고", () => {
    const bad: Script = {
      ...sample,
      hookIndex: 0,
      hooks: ["충격! 이걸 몰랐다니", "아직도 이렇게 쓰세요?", "하나면 끝"],
      problem: [{ text: "매번 찾기 힘들고", clipHint: "x", emphasis: "없는단어" }],
      titles: ["이거 하나면 모든 게 끝나는 놀라운 방법, 아직 모르셨다면 꼭 보세요 서랍 정리"],
      onScreenTitle: "서랍 정리가 이렇게 쉬웠다니",
      hashtags: { broad: ["#살림템"], mid: [], specific: [] },
    };
    const w = lintMetadata(bad).join("\n");
    expect(w).toMatch(/40자 이내/);
    expect(w).toMatch(/뒤쪽/);
    expect(w).toMatch(/첫 3초/);
    expect(w).toMatch(/12자 이내/);
    expect(w).toMatch(/해시태그가 1개/);
    expect(w).toMatch(/강조 단어 "없는단어"/);
    expect(w).toMatch(/낚시/);
  });

  it("검색 키워드가 없으면 알려 줌", () => {
    expect(lintMetadata({ ...sample, searchKeywords: [] }).join()).toMatch(/검색 키워드/);
  });
});

describe("자막: 제목 카드·강조", () => {
  const segs = [
    { text: "서랍 정리 이거 하나로 끝", start: 0, end: 2 },
    { text: "수저가 뒤섞여서 찾기 힘들고", start: 2.1, end: 4 },
  ];

  it("첫 1.5초 제목 카드, 대사보다 위(MarginV 작음)", () => {
    const ass = buildAss(segs, "광고", { titleCard: "서랍 정리 끝" });
    expect(ass).toContain(`Dialogue: 2,0:00:00.00,0:00:0${TITLE_CARD_SECONDS.toFixed(2)},Title,,0,0,0,,서랍 정리 끝`);
    const mv = (style: string) => Number(ass.match(new RegExp(`Style: ${style},.*,(\\d+),1$`, "m"))![1]);
    expect(mv("Disclosure")).toBeLessThan(mv("Title"));
    expect(mv("Title") + 130).toBeLessThan(mv("Line"));
  });

  it("강조 단어만 노란색, 줄이 나뉘어도 그 단어가 있는 조각에만", () => {
    expect(emphasize("수저가 뒤섞여서", "수저")).toBe("{\\1c&H00FFFF&}수저{\\1c&HFFFFFF&}가 뒤섞여서");
    expect(emphasize("찾기 힘들고", "수저")).toBe("찾기 힘들고");
    const ass = buildAss(segs, "광고", { emphasis: ["서랍", "수저"] });
    expect(ass.match(/\\1c&H00FFFF&/g)).toHaveLength(2);
  });

  it("제목 카드 없으면 Title 이벤트 없음", () => {
    expect(buildAss(segs, "광고")).not.toMatch(/,Title,/);
  });
});

describe("네이버 검색광고 API", () => {
  it("HMAC 서명·헤더, 힌트 정리, 모바일 검색량 순", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const f = (async (url: string, init?: RequestInit) => {
      seen = { url, headers: init!.headers as Record<string, string> };
      return new Response(
        JSON.stringify({
          keywordList: [
            { relKeyword: "서랍정리", monthlyPcQcCnt: 1000, monthlyMobileQcCnt: 8000, compIdx: "중간" },
            { relKeyword: "수저정리함", monthlyPcQcCnt: "< 10", monthlyMobileQcCnt: 2400, compIdx: "낮음" },
            { relKeyword: "냉장고", monthlyPcQcCnt: 90000, monthlyMobileQcCnt: 99000, compIdx: "높음" },
          ],
        }),
      );
    }) as typeof fetch;
    const vols = await keywordVolumes(["서랍 정리", "수저 정리"], { key: "k", secret: "s", customer: "c" }, f, () => 1700000000000);
    expect(seen!.url).toContain("hintKeywords=" + encodeURIComponent("서랍정리,수저정리"));
    expect(seen!.headers["X-Signature"]).toBe(signature("s", "1700000000000"));
    expect(seen!.headers["X-Customer"]).toBe("c");
    expect(vols.find((v) => v.keyword === "수저정리함")!.monthlyPc).toBe(5);
    expect(rankKeywords(vols, ["서랍 정리", "수저 정리"]).map((v) => v.keyword)).toEqual(["서랍정리", "수저정리함"]);
  });
});

describe("성과에서 배우기", () => {
  const row = (id: number, hookType: string, views: number, postedAt: string | null = null, status = "PUBLISHED"): ReportRow => ({
    id,
    productName: "p",
    status,
    minutes: 0,
    aiCredits: 0,
    aiUsd: 0,
    provider: null,
    hookType,
    keyword: "서랍 정리",
    postedAt,
    views,
    clicks: 0,
    orders: 0,
    commission: 0,
    byPlatform: {},
  });

  it("훅 유형별 중앙값 비교, 표본 부족 표시, 미공개 제외", () => {
    const rows = [...Array.from({ length: MIN_SAMPLE }, (_, i) => row(i, "질문", 1000 * (i + 1))), row(10, "반전", 9000), row(11, "반전", 1, null, "EXPORTED")];
    const g = groupReport(rows, "hook");
    expect(g[0]).toMatchObject({ group: "반전", count: 1, medianViews: 9000, enough: false });
    expect(g[1]).toMatchObject({ group: "질문", count: MIN_SAMPLE, medianViews: 3000, enough: true });
  });

  it("올린 시간대별", () => {
    const g = groupReport([row(1, "질문", 10, "2026-10-01T20:05"), row(2, "질문", 30, "2026-10-02T20:40"), row(3, "질문", 5, null)], "hour");
    expect(g.map((x) => [x.group, x.medianViews])).toEqual([
      ["20시", 20],
      ["(미기록)", 5],
    ]);
  });
});
