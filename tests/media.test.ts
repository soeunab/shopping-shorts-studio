import { describe, expect, it } from "vitest";
import { buildRenderArgs, escapeFilterPath, planShots } from "../src/media/render.js";
import { assTime, buildAss, wrapLine } from "../src/media/subtitles.js";
import { estimateSegments, sayArgs } from "../src/media/tts.js";
import { uploadBody, videoIdOf } from "../src/publish/youtube.js";

const segs = [
  { text: "하나", start: 0, end: 1.5 },
  { text: "둘", start: 1.65, end: 3 },
  { text: "셋", start: 3.15, end: 4 },
];

describe("자막", () => {
  it("ASS 시간 형식", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61.234)).toBe("0:01:01.23");
  });

  it("긴 줄은 가운데 공백에서 두 줄로", () => {
    expect(wrapLine("짧은 줄")).toBe("짧은 줄");
    expect(wrapLine("이거 하나 해줬더니 집에서 계속 만들어 달래요")).toContain("\n");
  });

  it("대가 표기가 영상 내내 표시", () => {
    const ass = buildAss(segs, "광고");
    expect(ass).toMatch(/Dialogue: 1,0:00:00\.00,0:00:04\.50,Disclosure,,0,0,0,,광고/);
    expect(ass.match(/,Line,/g)).toHaveLength(3);
  });
});

describe("음성", () => {
  it("say 인자", () => {
    expect(sayArgs("안녕", "/tmp/a.aiff", "Yuna", "200")).toEqual(["-v", "Yuna", "-r", "200", "-o", "/tmp/a.aiff", "--data-format=LEI16@44100", "안녕"]);
  });

  it("외부 음성 파일 타이밍은 글자 수 비율", () => {
    const s = estimateSegments(["가나", "가나다라"], 6);
    expect(s[0]!.end).toBeCloseTo(2);
    expect(s[1]!.end).toBeCloseTo(6);
  });
});

describe("렌더", () => {
  const clips = [
    { file: "/d/a.mp4", kind: "OWN" as const },
    { file: "/d/b.jpg", kind: "AI" as const },
  ];

  it("컷 길이 = 다음 줄 시작까지, 소스는 순환", () => {
    const shots = planShots(clips, segs);
    expect(shots.map((s) => s.duration)).toEqual([1.65, 1.5, 1.35]);
    expect(shots[2]!.clip.file).toBe("/d/a.mp4");
  });

  it("원음 제거·세로 1080x1920·자막·하드웨어 인코더", () => {
    const args = buildRenderArgs({ shots: planShots(clips, segs), audio: "/d/n.m4a", assFile: "/d/s.ass", out: "/d/o.mp4", hardware: true });
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("crop=1080:1920");
    expect(graph).toContain("zoompan");
    expect(graph).toContain("concat=n=3:v=1:a=0");
    expect(graph).toContain("subtitles=");
    expect(args).toContain("h264_videotoolbox");
    // 오디오는 내레이션 입력(마지막 입력)에서만
    expect(args[args.lastIndexOf("-map") + 1]).toBe("3:a");
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
