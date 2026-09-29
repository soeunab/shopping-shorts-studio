import { describe, expect, it } from "vitest";
import { checkClip, checkClips } from "../src/sources/license.js";

describe("소스 라이선스 점검", () => {
  it("직접 촬영·AI 는 통과", () => {
    expect(checkClip({ file: "a.mp4", kind: "OWN" })).toEqual([]);
    expect(checkClip({ file: "a.png", kind: "AI" })).toEqual([]);
  });

  it("도우인·틱톡·유튜브 등 다른 사람 영상 출처는 거부", () => {
    for (const url of ["https://www.douyin.com/video/1", "https://v.douyin.com/abc", "https://www.tiktok.com/@a/video/1", "https://youtu.be/abc", "https://m.youtube.com/shorts/x", "https://www.xiaohongshu.com/x"]) {
      expect(checkClip({ file: "a.mp4", kind: "OWN", sourceUrl: url }).length, url).toBeGreaterThan(0);
    }
  });

  it("스톡은 확인된 사이트 URL 이 필요", () => {
    expect(checkClip({ file: "a.mp4", kind: "STOCK" })).toHaveLength(1);
    expect(checkClip({ file: "a.mp4", kind: "STOCK", sourceUrl: "https://www.pexels.com/video/123/" })).toEqual([]);
    expect(checkClip({ file: "a.mp4", kind: "STOCK", sourceUrl: "https://example.com/v" })).toHaveLength(1);
  });

  it("스톡으로 위장한 틱톡 URL 도 거부", () => {
    expect(checkClip({ file: "a.mp4", kind: "STOCK", sourceUrl: "https://www.tiktok.com/@a/video/1" }).length).toBeGreaterThan(0);
  });

  it("허락·상품 이미지는 근거가 필요", () => {
    expect(checkClip({ file: "a.mp4", kind: "PERMISSION" })).toHaveLength(1);
    expect(checkClip({ file: "a.mp4", kind: "PERMISSION", proof: "mail/2026-09-29.eml" })).toEqual([]);
    expect(checkClip({ file: "a.jpg", kind: "PRODUCT_IMAGE", sourceUrl: "https://www.coupang.com/vp/products/1" })).toHaveLength(1);
  });

  it("소스가 없으면 렌더 불가", () => {
    expect(checkClips([])).toHaveLength(1);
  });
});
