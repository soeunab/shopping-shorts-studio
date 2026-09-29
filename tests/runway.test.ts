import { describe, expect, it } from "vitest";
import { API_BASE, checkProductPrompt, estimateCredits, planAiJobs, productPrompt, PRODUCT_MOTIONS, requestBody, RUNWAY_VERSION, RunwayClient, scenePrompt } from "../src/ai/runway.js";
import { checkClip } from "../src/sources/license.js";
import { sample } from "./fixtures.js";

describe("상품 영상 프롬프트 가드", () => {
  it("기본 모션 템플릿은 모두 통과", () => {
    for (const m of PRODUCT_MOTIONS) expect(checkProductPrompt(productPrompt(m))).toEqual([]);
  });

  it("기능·효과 연출은 거부", () => {
    expect(checkProductPrompt("Camera push-in while the organizer cleans the drawer").length).toBeGreaterThan(0);
    expect(checkProductPrompt("orbit around product, before and after").length).toBeGreaterThan(0);
    expect(checkProductPrompt("slow orbit, hands using the product").length).toBeGreaterThan(0);
  });

  it("카메라 움직임이 없으면 거부", () => {
    expect(checkProductPrompt("A beautiful product on a table")).toHaveLength(1);
  });
});

describe("생성 계획·비용", () => {
  it("상품 이미지 → 카메라 모션, 공감 줄 → 상황 영상, 분위기는 선택", () => {
    const jobs = planAiJobs(sample, ["/d/p.jpg"], { products: 2, context: true });
    expect(jobs.map((j) => [j.type, j.role])).toEqual([
      ["image_to_video", "PRODUCT"],
      ["image_to_video", "PRODUCT"],
      ["text_to_video", "PROBLEM"],
      ["text_to_video", "CONTEXT"],
    ]);
    expect(jobs[0]!.prompt).not.toBe(jobs[1]!.prompt);
    expect(jobs[2]!.prompt).toContain("messy kitchen drawer");
    expect(jobs[2]!.prompt).toContain("Do not show any specific product");
  });

  it("상품 이미지가 없으면 상품 영상 없음", () => {
    expect(planAiJobs(sample, [], { products: 2 }).every((j) => j.role !== "PRODUCT")).toBe(true);
  });

  it("예상 크레딧: gen4_turbo 5/초, gen4.5 12/초, 모르는 모델은 null", () => {
    const jobs = planAiJobs(sample, ["/d/p.jpg"], { products: 1 });
    expect(estimateCredits(jobs)).toBe(5 * 5 + 12 * 5);
    expect(estimateCredits([{ ...jobs[0]!, model: "unknown" }])).toBeNull();
  });

  it("요청 본문: 세로 비율, 이미지→영상만 promptImage", () => {
    const [i2v, t2v] = planAiJobs(sample, ["/d/p.jpg"], { products: 1 });
    expect(requestBody(i2v!, "data:image/jpeg;base64,xx")).toMatchObject({ model: "gen4_turbo", ratio: "720:1280", duration: 5, promptImage: "data:image/jpeg;base64,xx" });
    expect(requestBody(t2v!)).not.toHaveProperty("promptImage");
    expect(scenePrompt("messy drawer.")).toMatch(/^messy drawer\. Vertical/);
  });
});

describe("Runway 클라이언트", () => {
  it("제출 → 대기 → 결과 URL, 인증·버전 헤더", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const replies = [{ id: "task-1" }, { id: "task-1", status: "RUNNING" }, { id: "task-1", status: "SUCCEEDED", output: ["https://out/v.mp4"] }];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }) as typeof fetch;
    const c = new RunwayClient("key_x", fakeFetch, async () => {});
    const [job] = planAiJobs(sample, [], { products: 0 });
    const id = await c.submit(job!);
    expect(await c.wait(id, { intervalMs: 0 })).toBe("https://out/v.mp4");
    expect(calls[0]!.url).toBe(`${API_BASE}/text_to_video`);
    expect(calls[1]!.url).toBe(`${API_BASE}/tasks/task-1`);
    expect((calls[0]!.init!.headers as Record<string, string>)["X-Runway-Version"]).toBe(RUNWAY_VERSION);
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer key_x");
  });

  it("실패 상태는 오류", async () => {
    const f = (async () => new Response(JSON.stringify({ id: "t", status: "FAILED", failure: "moderation" }))) as unknown as typeof fetch;
    await expect(new RunwayClient("k", f, async () => {}).wait("t")).rejects.toThrow(/moderation/);
  });

  it("키 없으면 안내", () => {
    expect(() => new RunwayClient("")).toThrow(/RUNWAYML_API_SECRET/);
  });
});

describe("AI_FROM_PRODUCT 소스", () => {
  const ok = {
    file: "a.mp4",
    kind: "AI_FROM_PRODUCT" as const,
    role: "PRODUCT" as const,
    sourceUrl: "https://www.coupang.com/vp/products/1",
    proof: "파트너스 상품 이미지",
    derivedFrom: "p.jpg",
    prompt: productPrompt(PRODUCT_MOTIONS[0]!),
  };

  it("원본·근거·모션 프롬프트가 있으면 상품 장면으로 사용 가능", () => {
    expect(checkClip(ok)).toEqual([]);
  });

  it("효과 연출 프롬프트나 원본 기록이 없으면 거부", () => {
    expect(checkClip({ ...ok, prompt: "camera orbit while it cleans the sink" }).length).toBeGreaterThan(0);
    expect(checkClip({ ...ok, derivedFrom: undefined }).length).toBeGreaterThan(0);
  });
});
