import { describe, expect, it } from "vitest";
import { buildRenderArgs, escapeFilterPath, planShots, poolFor, rng, type RoleSegment } from "../src/media/render.js";
import { assTime, buildAss, chunkLine, subtitleCues } from "../src/media/subtitles.js";
import { alignToPauses, estimateSegments, parseSilences, pickSayVoice, sayArgs, tempoFilter } from "../src/media/tts.js";
import { googleTtsBody } from "../src/media/googleTts.js";
import { uploadBody, videoIdOf } from "../src/publish/youtube.js";
import { ClipSchema } from "../src/sources/license.js";

const segs: RoleSegment[] = [
  { text: "하나", start: 0, end: 1.5, role: "HOOK" },
  { text: "둘", start: 1.65, end: 3, role: "PROBLEM" },
  { text: "셋", start: 3.15, end: 8, role: "SOLUTION" },
];

describe("자막", () => {
  it("ASS 시간 형식", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61.234)).toBe("0:01:01.23");
  });

  it("한 줄에 들어가게 띄어쓰기 기준으로 나눔", () => {
    expect(chunkLine("짧은 줄")).toEqual(["짧은 줄"]);
    const parts = chunkLine("수저가 뒤섞여서 매번 찾기 힘들었다면 이거 보세요");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 13)).toBe(true);
    expect(parts.join(" ")).toBe("수저가 뒤섞여서 매번 찾기 힘들었다면 이거 보세요");
  });

  it("조각별 시간은 대사 구간 안에서 이어짐", () => {
    const cues = subtitleCues([{ text: "수저가 뒤섞여서 매번 찾기 힘들었다면", start: 2, end: 5 }]);
    expect(cues[0]!.start).toBe(2);
    expect(cues.at(-1)!.end).toBeCloseTo(5);
  });

  it("대가 표기가 영상 내내, 대사는 위쪽 정렬", () => {
    const ass = buildAss(segs, "광고");
    expect(ass).toMatch(/Dialogue: 1,0:00:00\.00,0:00:08\.50,Disclosure,,0,0,0,,광고/);
    expect(ass).toMatch(/Style: Line,[^\n]*,8,60,60,500,1/);
  });
});

describe("음성", () => {
  it("say 인자", () => {
    expect(sayArgs("안녕", "/tmp/a.aiff", "Yuna", "200")).toEqual(["-v", "Yuna", "-r", "200", "-o", "/tmp/a.aiff", "--data-format=LEI16@44100", "안녕"]);
  });

  it("맥 음성 목록에서 프리미엄 > 향상 > 기본 순으로 선택", () => {
    const list = "Alex                en_US    # Hi\nYuna                ko_KR    # 안녕\nYuna (Enhanced)     ko_KR    # 안녕\nYuna (Premium)      ko_KR    # 안녕";
    expect(pickSayVoice(list)).toBe("Yuna (Premium)");
    expect(pickSayVoice("Yuna                ko_KR    # 안녕")).toBe("Yuna");
    expect(pickSayVoice("")).toBe("Yuna");
  });

  it("속도 조절은 atempo, 1배속이면 없음", () => {
    expect(tempoFilter(1)).toBeNull();
    expect(tempoFilter(1.2)).toBe("atempo=1.200");
    expect(tempoFilter(5)).toBe("atempo=2.000");
  });

  it("Google TTS 요청", () => {
    expect(googleTtsBody("안녕", "ko-KR-Neural2-A", 1.1)).toMatchObject({ voice: { languageCode: "ko-KR", name: "ko-KR-Neural2-A" }, audioConfig: { speakingRate: 1.1 } });
  });

  it("외부 음성: 글자 수 비율 추정", () => {
    const s = estimateSegments(["가나", "가나다라"], 6);
    expect(s[0]!.end).toBeCloseTo(2);
    expect(s[1]!.end).toBeCloseTo(6);
  });

  it("외부 음성: 숨 쉬는 구간(무음)으로 경계 이동", () => {
    const pauses = parseSilences("[silencedetect] silence_start: 2.4\n[silencedetect] silence_end: 2.8 | silence_duration: 0.4\nsilence_start: 7\n");
    expect(pauses).toEqual([{ start: 2.4, end: 2.8 }]);
    const s = alignToPauses(["가나", "가나다라"], 6, pauses);
    expect(s[0]!.end).toBeCloseTo(2.6);
    expect(s[1]!.start).toBeCloseTo(2.6);
    expect(s[1]!.end).toBe(6);
  });
});

describe("컷 계획", () => {
  const clips = [
    ClipSchema.parse({ file: "/d/problem.mp4", kind: "STOCK", role: "PROBLEM", sourceUrl: "https://www.pexels.com/video/1/" }),
    ClipSchema.parse({ file: "/d/ctx.mp4", kind: "STOCK", role: "CONTEXT", sourceUrl: "https://www.pexels.com/video/2/" }),
    ClipSchema.parse({ file: "/d/product.jpg", kind: "PRODUCT_IMAGE", role: "PRODUCT", sourceUrl: "https://www.coupang.com/vp/products/1", proof: "파트너스 상품 이미지" }),
  ];
  const durations = new Map([
    ["/d/problem.mp4", 12],
    ["/d/ctx.mp4", 10],
  ]);

  it("역할별 우선 장면: 훅은 상품, 공감은 문제 장면", () => {
    expect(poolFor(clips, "HOOK").map((c) => c.role)).toEqual(["PRODUCT"]);
    expect(poolFor(clips, "PROBLEM").map((c) => c.role)).toEqual(["PROBLEM"]);
    expect(poolFor(clips, "SOLUTION").map((c) => c.role).sort()).toEqual(["CONTEXT", "PRODUCT"]);
  });

  it("2.8초보다 긴 구간은 여러 컷, 총 길이 보존, 영상은 무작위 구간", () => {
    const shots = planShots(clips, segs, durations, { seed: 7 });
    const total = shots.reduce((a, s) => a + s.duration, 0);
    expect(total).toBeCloseTo(8.5, 1);
    expect(shots.every((s) => s.duration <= 2.8 + 1e-6)).toBe(true);
    expect(shots[0]!.clip.role).toBe("PRODUCT");
    expect(shots[1]!.clip.role).toBe("PROBLEM");
    for (const s of shots) if (s.clip.file.endsWith(".mp4")) expect(s.offset).toBeLessThanOrEqual(durations.get(s.clip.file)! - s.duration);
  });

  it("같은 쇼츠는 같은 편집, 다른 쇼츠는 다른 편집", () => {
    const a = planShots(clips, segs, durations, { seed: 1 });
    expect(planShots(clips, segs, durations, { seed: 1 })).toEqual(a);
    expect(planShots(clips, segs, durations, { seed: 2 })).not.toEqual(a);
  });

  it("난수 재현성", () => {
    const r1 = rng(3);
    const r2 = rng(3);
    expect([r1(), r1()]).toEqual([r2(), r2()]);
  });

  it("ffmpeg: 구간 잘라 읽기, 원음 제거, 세로 크롭, 자막, 하드웨어 인코더", () => {
    const shots = planShots(clips, segs, durations, { seed: 7 });
    const args = buildRenderArgs({ shots, audio: "/d/n.m4a", assFile: "/d/s.ass", out: "/d/o.mp4", hardware: true });
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("crop=1080:1920");
    expect(graph).toContain(`concat=n=${shots.length}:v=1:a=0`);
    expect(graph).toContain("subtitles=");
    expect(args).toContain("-ss");
    expect(args).toContain("h264_videotoolbox");
    expect(args[args.lastIndexOf("-map") + 1]).toBe(`${shots.length}:a`);
  });

  it("경로 이스케이프", () => {
    expect(escapeFilterPath("/a:b/c'd.ass")).toBe("/a\\:b/c\\'d.ass");
  });
});

describe("유튜브", () => {
  it("업로드는 항상 비공개", () => {
    expect(uploadBody({ title: "t", description: "d", tags: [], syntheticMedia: true }).status).toMatchObject({ privacyStatus: "private", containsSyntheticMedia: true });
  });

  it("영상 ID 추출", () => {
    expect(videoIdOf("https://youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
  });
});
