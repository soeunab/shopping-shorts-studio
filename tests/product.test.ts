import { describe, expect, it } from "vitest";
import { categoryMatches, evaluate, failedCriteria } from "../src/product/score.js";
import { buildCaptions, buildLinks } from "../src/publish/export.js";
import { COUPANG_DISCLOSURE, SHOPPING_CONNECT_DISCLOSURE } from "../src/script/generate.js";
import { chooseVideos, pickPexelsFile, type PexelsVideo } from "../src/sources/pexels.js";
import { sample } from "./fixtures.js";

describe("제품 선정 4기준", () => {
  it("카테고리 부분 일치", () => {
    expect(categoryMatches("주방", "주방·살림")).toBe(true);
    expect(categoryMatches("살림", "주방·살림")).toBe(true);
    expect(categoryMatches("캠핑", "주방·살림")).toBe(false);
    expect(categoryMatches(null, "주방·살림")).toBe(false);
  });

  it("문제 해결은 무엇을 해결하는지 적어야 통과", () => {
    const s = evaluate({ novel: true, solves: "  ", season: true, categoryMatch: true });
    expect(s.passed).toBe(3);
    expect(failedCriteria(s)).toEqual(["문제 해결(무엇을 해결하는지 불명확)"]);
    expect(evaluate({ novel: true, solves: "수저 뒤섞임", season: true, categoryMatch: true }).passed).toBe(4);
  });
});

describe("플랫폼별 내보내기", () => {
  it("모든 캡션 첫 줄이 대가 표기, 네이버는 쇼핑커넥트 링크가 있으면 그 표기", () => {
    const withNaver = buildCaptions({ naverUrl: "https://naver.me/x" }, sample);
    expect(withNaver.instagram.split("\n")[0]).toBe(COUPANG_DISCLOSURE);
    expect(withNaver.tiktok.split("\n")[0]).toBe(COUPANG_DISCLOSURE);
    expect(withNaver.naver.split("\n")[0]).toBe(SHOPPING_CONNECT_DISCLOSURE);
    expect(withNaver.youtube).toContain(`[설명]\n${COUPANG_DISCLOSURE}`);
    expect(buildCaptions({ naverUrl: null }, sample).naver.split("\n")[0]).toBe(COUPANG_DISCLOSURE);
  });

  it("인스타는 댓글 키워드 DM 안내, 링크는 캡션에 넣지 않음", () => {
    const c = buildCaptions({ naverUrl: null }, sample);
    expect(c.instagram).toContain("'칸막이'");
    expect(c.instagram).not.toMatch(/https?:\/\//);
    expect(buildLinks({ productName: "서랍 칸막이", productUrl: "https://link.coupang.com/a/x", naverUrl: null }, sample)).toContain("https://link.coupang.com/a/x");
  });
});

describe("Pexels", () => {
  const video = (id: number, files: PexelsVideo["video_files"]): PexelsVideo => ({ id, url: `https://www.pexels.com/video/${id}/`, duration: 10, width: 1080, height: 1920, video_files: files });

  it("세로 mp4 중 1920 에 가장 가까운 파일", () => {
    const v = video(1, [
      { link: "a", width: 1920, height: 1080, file_type: "video/mp4" },
      { link: "b", width: 720, height: 1280, file_type: "video/mp4" },
      { link: "c", width: 1080, height: 1920, file_type: "video/mp4" },
      { link: "d", width: 2160, height: 3840, file_type: "video/mp4" },
    ]);
    expect(pickPexelsFile(v)?.link).toBe("c");
    expect(pickPexelsFile(video(2, [{ link: "a", width: 1920, height: 1080, file_type: "video/mp4" }]))).toBeNull();
  });

  it("이미 쓴 영상 제외", () => {
    const f = [{ link: "x", width: 1080, height: 1920, file_type: "video/mp4" }];
    const picks = chooseVideos([video(1, f), video(2, f), video(3, f)], new Set(["https://www.pexels.com/video/1/"]), 2);
    expect(picks.map((p) => p.video.id)).toEqual([2, 3]);
  });
});
