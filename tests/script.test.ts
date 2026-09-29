import { describe, expect, it } from "vitest";
import { claudeCodeArgs, subscriptionEnv } from "../src/llm/claudeCode.js";
import { buildPrompt, fakeExperienceLines, narration, PLACEHOLDER, placeholdersIn, ScriptSchema, SYSTEM } from "../src/script/generate.js";
import type { ShortRow } from "../src/db.js";
import { sample } from "./fixtures.js";

const short = { id: 1, productName: "서랍 칸막이", category: "주방", program: "COUPANG", facts: [] } as unknown as ShortRow;

describe("대본", () => {
  it("선택한 훅 → 공감 → 해결 → 마무리 순서와 역할", () => {
    const n = narration(sample);
    expect(n.map((l) => l.role)).toEqual(["HOOK", "PROBLEM", "SOLUTION", "SOLUTION", "CTA"]);
    expect(n[0]!.text).toBe(sample.hooks[1]);
  });

  it("hookIndex 기본값 0", () => {
    const { hookIndex: _h, ...rest } = sample;
    expect(ScriptSchema.parse(rest).hookIndex).toBe(0);
  });

  it("[경험 추가] 자리표시 탐지", () => {
    expect(placeholdersIn(sample)).toHaveLength(1);
  });

  it("사실이 없으면 자리표시, 1인칭 경험 금지를 지시", () => {
    expect(buildPrompt(short, "수저 뒤섞임")).toContain(PLACEHOLDER);
    expect(buildPrompt(short, "수저 뒤섞임")).toContain("수저 뒤섞임");
    expect(SYSTEM).toContain("내돈내산");
  });

  it("직접 써 본 경험이 없으면 1인칭 사용 경험 문장을 잡아냄", () => {
    const fake = ScriptSchema.parse({ ...sample, cta: "제가 써 보니 진짜 편해요" });
    expect(fakeExperienceLines(fake, [])).toEqual(["제가 써 보니 진짜 편해요"]);
    expect(fakeExperienceLines(fake, ["경험: 2주 사용, 서랍 3칸에 맞음"])).toEqual([]);
    expect(fakeExperienceLines(sample, [])).toEqual([]);
  });
});

describe("Claude Code 구독 호출", () => {
  it("API 키 환경변수 제거", () => {
    const e = subscriptionEnv({ ANTHROPIC_API_KEY: "x", PATH: "/bin" });
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.PATH).toBe("/bin");
  });

  it("도구 모두 끔", () => {
    const args = claudeCodeArgs({ system: "s", prompt: "p" });
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
});
