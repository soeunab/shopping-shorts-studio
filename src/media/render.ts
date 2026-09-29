import path from "node:path";
import type { LineRole } from "../script/generate.js";
import type { Clip, Role } from "../sources/license.js";
import type { Segment } from "./tts.js";

export const W = 1080;
export const H = 1920;
export const FPS = 30;
/** 한 컷 최대 길이(초) — 2~3초마다 장면을 바꿔 시청 지속을 돕고, 같은 소스라도 매번 다른 구간을 씁니다. */
export const MAX_CUT = 2.8;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
export const isImage = (file: string) => IMAGE_EXT.has(path.extname(file).toLowerCase());

export type RoleSegment = Segment & { role: LineRole };
export type Shot = { clip: Clip; duration: number; offset: number };

/** 재현 가능한 난수(쇼츠 번호를 시드로 → 같은 쇼츠는 같은 편집, 쇼츠마다 다른 편집) */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 대사 역할별로 어떤 장면을 우선 쓸지 (앞 단계가 비면 다음 단계) */
const PREFERENCE: Record<LineRole, Role[][]> = {
  HOOK: [["HOOK"], ["PRODUCT"], ["CONTEXT", "PROBLEM"]],
  PROBLEM: [["PROBLEM"], ["CONTEXT"], ["HOOK", "PRODUCT"]],
  SOLUTION: [["PRODUCT", "CONTEXT"], ["HOOK"], ["PROBLEM"]],
  CTA: [["PRODUCT"], ["CONTEXT", "HOOK"], ["PROBLEM"]],
};

export function poolFor(clips: Clip[], role: LineRole): Clip[] {
  for (const tier of PREFERENCE[role]) {
    const pool = clips.filter((c) => tier.includes(c.role));
    if (pool.length) return pool;
  }
  return clips;
}

/**
 * 컷 계획: 대사 구간마다 역할에 맞는 소스를 고르고, 2.8초보다 길면 여러 컷으로 나눕니다.
 * 영상 소스는 무작위 구간(offset)을 잘라 써서 같은 소스라도 매번 다른 장면이 됩니다.
 */
export function planShots(clips: Clip[], segments: RoleSegment[], durations: Map<string, number>, opts: { seed?: number; tail?: number; maxCut?: number } = {}): Shot[] {
  if (!clips.length) throw new Error("영상 소스가 없어요.");
  const rand = rng(opts.seed ?? 1);
  const maxCut = opts.maxCut ?? MAX_CUT;
  const queues = new Map<LineRole, { order: Clip[]; i: number }>();
  let last: Clip | null = null;
  const next = (role: LineRole): Clip => {
    let q = queues.get(role);
    if (!q) {
      q = { order: shuffle(poolFor(clips, role), rand), i: 0 };
      queues.set(role, q);
    }
    let c = q.order[q.i++ % q.order.length]!;
    if (c === last && q.order.length > 1) c = q.order[q.i++ % q.order.length]!;
    last = c;
    return c;
  };

  const shots: Shot[] = [];
  segments.forEach((s, i) => {
    const following = segments[i + 1];
    const span = Math.max(0.5, (following ? following.start : s.end + (opts.tail ?? 0.5)) - s.start);
    const n = Math.max(1, Math.ceil(span / maxCut - 1e-9));
    const each = +(span / n).toFixed(3);
    for (let k = 0; k < n; k++) {
      const clip = next(s.role);
      const len = durations.get(clip.file) ?? 0;
      const offset = !isImage(clip.file) && len > each + 0.2 ? +(rand() * (len - each)).toFixed(2) : 0;
      shots.push({ clip, duration: each, offset });
    }
  });
  return shots;
}

/** ffmpeg filtergraph 경로 이스케이프 (subtitles=경로) */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export type RenderPlan = {
  shots: Shot[];
  audio: string;
  assFile: string;
  out: string;
  /** Apple Silicon 하드웨어 인코더 사용 여부 */
  hardware?: boolean;
};

/**
 * 세로 1080x1920 30fps mp4 를 만드는 ffmpeg 인자.
 * - 소스 원음은 모두 버리고 내레이션만 씁니다.
 * - 화면을 꽉 채우도록 확대 후 가운데를 잘라냅니다(cover).
 * - 이미지는 천천히 확대(켄 번스)해 정지 화면 느낌을 줄입니다.
 */
export function buildRenderArgs(plan: RenderPlan): string[] {
  const args = ["-y", "-v", "error"];
  for (const s of plan.shots) {
    if (isImage(s.clip.file)) args.push("-loop", "1", "-framerate", String(FPS), "-t", String(s.duration), "-i", s.clip.file);
    else args.push("-stream_loop", "-1", "-ss", String(s.offset), "-t", String(s.duration), "-i", s.clip.file);
  }
  const audioIdx = plan.shots.length;
  args.push("-i", plan.audio);

  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const chains = plan.shots.map((s, i) => {
    const frames = Math.max(1, Math.round(s.duration * FPS));
    const motion = isImage(s.clip.file)
      ? `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0008,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`
      : `${cover},fps=${FPS}`;
    return `[${i}:v]${motion},setsar=1,format=yuv420p,trim=duration=${s.duration},setpts=PTS-STARTPTS[v${i}]`;
  });
  const concatIn = plan.shots.map((_, i) => `[v${i}]`).join("");
  const graph = [
    ...chains,
    `${concatIn}concat=n=${plan.shots.length}:v=1:a=0[cat]`,
    `[cat]subtitles='${escapeFilterPath(plan.assFile)}'[vout]`,
  ].join(";");

  args.push("-filter_complex", graph, "-map", "[vout]", "-map", `${audioIdx}:a`);
  if (plan.hardware) args.push("-c:v", "h264_videotoolbox", "-b:v", "8M", "-allow_sw", "1");
  else args.push("-c:v", "libx264", "-preset", "medium", "-crf", "20");
  args.push("-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", plan.out);
  return args;
}
