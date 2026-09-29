import { readFileSync } from "node:fs";
import { runOk } from "../media/exec.js";
import type { Script } from "../script/generate.js";

/**
 * Runway 개발자 API (공식 MCP 서버 runwayml/runway-api-mcp-server 와 같은 API)
 * - 키: https://dev.runwayml.com → RUNWAYML_API_SECRET (구독과 별개인 개발자 크레딧, 1크레딧 = $0.01)
 * - 결과 링크는 24시간만 유효 → 받자마자 내려받습니다.
 * - 생성 결과의 상업 이용·입력 이미지 권리는 Runway 약관과 제휴 프로그램 약관을 따릅니다.
 */
export const API_BASE = "https://api.dev.runwayml.com/v1";
export const RUNWAY_VERSION = "2024-11-06";
export const USD_PER_CREDIT = 0.01;

/** 초당 크레딧(공식 가격 안내 기준) — 표에 없는 모델은 비용을 모르므로 실행 전에 따로 확인받습니다. */
export const CREDITS_PER_SEC: Record<string, number> = { gen4_turbo: 5, "gen4.5": 12 };

export const I2V_MODEL = () => process.env.SSS_RUNWAY_I2V_MODEL?.trim() || "gen4_turbo";
export const T2V_MODEL = () => process.env.SSS_RUNWAY_T2V_MODEL?.trim() || "gen4.5";
export const RATIO = "720:1280";

// 프롬프트 가드는 도구와 상관없이 공통 — guard.ts
export { checkProductPrompt, checkScenePrompt, PRODUCT_MOTIONS, productPrompt, scenePrompt } from "./guard.js";
import { PRODUCT_MOTIONS, productPrompt, scenePrompt } from "./guard.js";

export type AiJob = {
  type: "image_to_video" | "text_to_video";
  role: "PRODUCT" | "PROBLEM" | "CONTEXT";
  model: string;
  prompt: string;
  duration: number;
  /** image_to_video 의 원본(실제 상품 이미지 소스) */
  baseFile?: string;
};

/**
 * 쇼츠 1편 생성 계획
 * - 상품: 등록된 실제 상품 이미지마다 카메라 모션 영상 (기본 2개)
 * - 문제: 대본 공감 줄의 장면 설명(clipHint)으로 텍스트→영상
 * - 분위기: 공간 장면 1개(선택)
 */
export function planAiJobs(
  script: Script,
  productImages: string[],
  opts: { products?: number; problem?: boolean; context?: boolean; contextHint?: string; customMotion?: string; duration?: number } = {},
): AiJob[] {
  const duration = opts.duration ?? 5;
  const jobs: AiJob[] = [];
  const n = opts.products ?? 2;
  for (let i = 0; i < n && productImages.length; i++) {
    const motion = opts.customMotion ?? PRODUCT_MOTIONS[i % PRODUCT_MOTIONS.length]!;
    jobs.push({ type: "image_to_video", role: "PRODUCT", model: I2V_MODEL(), prompt: productPrompt(motion), duration, baseFile: productImages[i % productImages.length] });
  }
  if (opts.problem !== false) {
    for (const l of script.problem) jobs.push({ type: "text_to_video", role: "PROBLEM", model: T2V_MODEL(), prompt: scenePrompt(l.clipHint), duration });
  }
  if (opts.context) {
    const hint = opts.contextHint ?? process.env.SSS_CONTEXT_PROMPT?.trim() ?? "bright tidy home kitchen, lifestyle b-roll, no products in focus";
    jobs.push({ type: "text_to_video", role: "CONTEXT", model: T2V_MODEL(), prompt: scenePrompt(hint), duration });
  }
  return jobs;
}

/** 예상 크레딧 — 요금을 모르는 모델이 있으면 null */
export function estimateCredits(jobs: AiJob[]): number | null {
  let sum = 0;
  for (const j of jobs) {
    const rate = CREDITS_PER_SEC[j.model];
    if (rate === undefined) return null;
    sum += rate * j.duration;
  }
  return sum;
}

export function requestBody(job: AiJob, promptImage?: string): Record<string, unknown> {
  const base = { model: job.model, promptText: job.prompt.slice(0, 1000), ratio: RATIO, duration: job.duration };
  return job.type === "image_to_video" ? { ...base, promptImage } : base;
}

/** 상품이 잘리지 않게 720x1280 에 흐린 배경으로 앉힌 JPEG → data URI */
export async function productImageDataUri(file: string, tmpOut: string): Promise<string> {
  await runOk("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    file,
    "-filter_complex",
    "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:5[bg];[0:v]scale=680:1240:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    tmpOut,
  ]);
  return `data:image/jpeg;base64,${readFileSync(tmpOut).toString("base64")}`;
}

type Fetch = typeof fetch;
export type TaskStatus = { id: string; status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "THROTTLED"; output?: string[]; failure?: string; error?: string };

export class RunwayClient {
  constructor(
    private readonly secret = process.env.RUNWAYML_API_SECRET?.trim() ?? "",
    private readonly f: Fetch = fetch,
    private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  ) {
    if (!this.secret) throw new Error("RUNWAYML_API_SECRET 가 필요해요(https://dev.runwayml.com 에서 발급, 결제 설정 필요).");
  }

  private async call(p: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.f(`${API_BASE}${p}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secret}`, "X-Runway-Version": RUNWAY_VERSION, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Runway ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  async submit(job: AiJob, promptImage?: string): Promise<string> {
    const r = (await this.call(`/${job.type}`, { method: "POST", body: JSON.stringify(requestBody(job, promptImage)) })) as { id?: string };
    if (!r.id) throw new Error("Runway 작업 번호를 받지 못했어요.");
    return r.id;
  }

  /** 완료될 때까지 기다린 뒤 결과 URL (최대 15분) */
  async wait(taskId: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<string> {
    const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    for (;;) {
      const t = (await this.call(`/tasks/${taskId}`)) as TaskStatus;
      if (t.status === "SUCCEEDED" && t.output?.[0]) return t.output[0];
      if (t.status === "FAILED" || t.status === "CANCELLED") throw new Error(`Runway 생성 실패(${taskId}): ${t.failure ?? t.error ?? t.status}`);
      if (Date.now() > deadline) throw new Error(`Runway 작업 ${taskId} 가 시간 안에 끝나지 않았어요. 나중에 대시보드에서 확인하세요.`);
      await this.sleep(opts.intervalMs ?? 5000);
    }
  }
}
