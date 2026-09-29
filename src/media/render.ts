import path from "node:path";
import type { Clip } from "../sources/license.js";
import type { Segment } from "./tts.js";

export const W = 1080;
export const H = 1920;
export const FPS = 30;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
export const isImage = (file: string) => IMAGE_EXT.has(path.extname(file).toLowerCase());

export type Shot = { clip: Clip; duration: number };

/**
 * 대사 줄마다 소스를 하나씩 배정(부족하면 순환). 각 컷 길이 = 그 줄의 길이.
 * 첫 컷은 훅이므로 사람이 가장 눈에 띄는 소스를 clips[0] 에 두면 됩니다.
 */
export function planShots(clips: Clip[], segments: Segment[], tail = 0.5): Shot[] {
  if (!clips.length) throw new Error("영상 소스가 없어요.");
  return segments.map((s, i) => {
    const next = segments[i + 1];
    const end = next ? next.start : s.end + tail;
    return { clip: clips[i % clips.length]!, duration: Math.max(0.5, +(end - s.start).toFixed(3)) };
  });
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
    else args.push("-stream_loop", "-1", "-t", String(s.duration), "-i", s.clip.file);
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
