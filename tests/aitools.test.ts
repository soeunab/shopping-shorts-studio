import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildBrief, BRIEF_RULES } from "../src/ai/brief.js";
import { checkProductPrompt, checkScenePrompt, PRODUCT_MOTIONS, productPrompt, scenePrompt } from "../src/ai/guard.js";
import { createShort, groupReport, openDb, providerOf, report, updateShort } from "../src/db.js";
import { checkClip } from "../src/sources/license.js";
import { sample } from "./fixtures.js";

describe("프롬프트 가드 (도구 공통)", () => {
  it("상품 컷: 아바타·후기·언박싱·들고 소개 금지", () => {
    for (const p of [
      "slow orbit, an AI avatar presents the product",
      "camera push-in, influencer unboxing",
      "orbit shot, UGC testimonial style",
      "camera pan while a spokesperson talks to the camera",
      "카메라 회전, 아바타가 들고 추천",
    ]) {
      expect(checkProductPrompt(p).length, p).toBeGreaterThan(0);
    }
  });

  it("상황 컷: 사람이 문제를 겪는 장면은 허용, 제품 소개·후기 연출은 금지", () => {
    expect(checkScenePrompt(scenePrompt("a tired woman searching a messy kitchen drawer"))).toEqual([]);
    expect(checkScenePrompt("a woman reviews the organizer and recommends it")).toHaveLength(1);
    expect(checkScenePrompt("influencer holding the product, talking to camera")).toHaveLength(1);
  });

  it("안전 문구(No people, Do not show…)는 금지어로 보지 않음", () => {
    for (const m of PRODUCT_MOTIONS) expect(checkProductPrompt(productPrompt(m))).toEqual([]);
  });

  it("배경·조명 묘사의 clean 은 허용, 닦는 연출의 clean 은 거부", () => {
    expect(checkProductPrompt("Gentle camera orbit around the exact product shown, clean neutral background")).toEqual([]);
    expect(checkProductPrompt("slow push-in, clean white studio lighting")).toEqual([]);
    expect(checkProductPrompt("slow push-in while it cleans the sink").length).toBeGreaterThan(0);
  });

  it("AI 소스 등록 시 장면 가드 적용", () => {
    expect(checkClip({ file: "a.mp4", kind: "AI", role: "PROBLEM", prompt: "unboxing review by an influencer" })).toHaveLength(1);
    expect(checkClip({ file: "a.mp4", kind: "AI", role: "PROBLEM", prompt: "messy drawer close-up" })).toEqual([]);
  });
});

describe("생성 요청서 (ai-brief)", () => {
  it("규칙·상품 컷(이미지 경로 포함)·상황 컷·등록 명령이 들어감", () => {
    const b = buildBrief({ shortId: 3, productName: "서랍 칸막이", script: sample, productImages: ["/d/clips/1-product.jpg"], target: "higgsfield" });
    for (const r of BRIEF_RULES) expect(b).toContain(r);
    expect(b).toContain("Higgsfield(MCP)");
    expect(b).toContain("이미지: /d/clips/1-product.jpg");
    expect(b.match(/\[상품 컷, 이미지→영상\]/g)).toHaveLength(2);
    expect(b).toContain("messy kitchen drawer");
    expect(b).toContain("ai-import 3");
    expect(b).toContain("--provider higgsfield");
    expect(b).toContain("아바타");
  });

  it("상품 이미지가 없으면 상황 컷만", () => {
    const b = buildBrief({ shortId: 1, productName: "x", script: sample, productImages: [], target: "runway" });
    expect(b).not.toContain("[상품 컷, 이미지→영상]");
    expect(b).toContain("[상황 컷, 텍스트→영상]");
    expect(b).toContain("gen4_turbo");
  });
});

describe("AI 도구별 비용·비교", () => {
  it("상품 컷 도구 판정", () => {
    expect(providerOf([{ kind: "AI", provider: "runway" }, { kind: "AI_FROM_PRODUCT", provider: "higgsfield" }])).toBe("higgsfield");
    expect(providerOf([{ kind: "AI", provider: "runway" }])).toBe("runway");
    expect(providerOf([{ kind: "STOCK" }])).toBeNull();
  });

  it("도구별 조회수 중앙값, AI 비용 달러 합", () => {
    const db = openDb(":memory:");
    const a = createShort(db, { productName: "A" });
    const b = createShort(db, { productName: "B" });
    updateShort(db, a.id, { status: "PUBLISHED", aiUsd: 0.5, clips: [{ kind: "AI_FROM_PRODUCT", provider: "higgsfield" }] });
    updateShort(db, b.id, { status: "PUBLISHED", aiUsd: 0.25, clips: [{ kind: "AI_FROM_PRODUCT", provider: "runway" }] });
    const rows = report(db);
    expect(rows.map((r) => r.provider)).toEqual(["higgsfield", "runway"]);
    expect(groupReport(rows, "provider").map((g) => g.group).sort()).toEqual(["higgsfield", "runway"]);
    expect(rows.reduce((s, r) => s + r.aiUsd, 0)).toBeCloseTo(0.75);
  });

  it("예전 Runway 크레딧 기록은 달러로 한 번 옮김", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sss-usd-"));
    const file = path.join(dir, "v.db");
    openDb(file).close();
    const raw = new DatabaseSync(file);
    raw.exec("ALTER TABLE shorts DROP COLUMN ai_usd; INSERT INTO shorts (product_name, ai_credits) VALUES ('옛 쇼츠', 110)");
    raw.close();
    const db = openDb(file);
    expect(report(db)[0]!.aiUsd).toBeCloseTo(1.1);
    db.close();
    expect(report(openDb(file))[0]!.aiUsd).toBeCloseTo(1.1);
    rmSync(dir, { recursive: true, force: true });
  });
});
