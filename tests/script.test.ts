import { describe, expect, it } from "vitest";
import { claudeCodeArgs, subscriptionEnv } from "../src/llm/claudeCode.js";
import { buildDescription, buildPrompt, COUPANG_DISCLOSURE, narrationLines, PLACEHOLDER, placeholdersIn, SYSTEM, type Script } from "../src/script/generate.js";
import type { ShortRow } from "../src/db.js";

const script: Script = {
  hook: "아이가 계속 만들어 달래요",
  lines: [
    { text: "틀에 요거트를 붓고", clipHint: "붓는 장면" },
    { text: `얼리면 ${PLACEHOLDER}`, clipHint: "완성" },
    { text: "막대만 꽂으면 끝", clipHint: "막대" },
  ],
  cta: "제품 정보는 프로필 링크에서",
  title: "아이 간식 틀",
  hashtags: ["#쇼츠", "#주방템"],
};

const short = { id: 1, productName: "실리콘 아이스크림 틀", category: "주방", program: "COUPANG", facts: [] } as unknown as ShortRow;

describe("대본", () => {
  it("훅 → 본문 → CTA 순서", () => {
    expect(narrationLines(script)).toHaveLength(5);
    expect(narrationLines(script)[0]).toBe(script.hook);
  });

  it("[경험 추가] 자리표시 탐지", () => {
    expect(placeholdersIn(script)).toHaveLength(1);
  });

  it("사실이 없으면 자리표시를 쓰라고 지시", () => {
    expect(buildPrompt(short)).toContain(PLACEHOLDER);
    expect(SYSTEM).toContain("지어내지 마세요");
  });

  it("설명란 첫 줄은 쿠팡 파트너스 대가 표기", () => {
    expect(buildDescription(short, script).split("\n")[0]).toBe(COUPANG_DISCLOSURE);
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
