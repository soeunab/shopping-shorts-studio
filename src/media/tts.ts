import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { probeDuration, runOk } from "./exec.js";

/**
 * 내레이션 음성 — 기본은 macOS 내장 `say`(무료·로컬, 한국어 음성 Yuna).
 * 더 자연스러운 음성은 약관상 상업 이용이 허용된 TTS 서비스에서 만든 파일이나
 * 직접 녹음한 파일을 `sss voice <id> <파일>` 로 넣을 수 있습니다.
 */
export type Segment = { text: string; start: number; end: number };

export function sayArgs(text: string, out: string, voice = process.env.SSS_VOICE?.trim() || "Yuna", rate = process.env.SSS_VOICE_RATE?.trim() || "210"): string[] {
  return ["-v", voice, "-r", rate, "-o", out, "--data-format=LEI16@44100", text];
}

/** 대사를 한 줄씩 합성 → 이어 붙이고, 줄별 시작·끝 시간을 돌려줍니다(자막 타이밍). */
export async function synthesize(lines: string[], dir: string, gap = 0.15): Promise<{ audio: string; segments: Segment[] }> {
  mkdirSync(dir, { recursive: true });
  const parts: string[] = [];
  const segments: Segment[] = [];
  let t = 0;
  for (const [i, text] of lines.entries()) {
    const aiff = path.join(dir, `line-${i}.aiff`);
    await runOk("say", sayArgs(text, aiff));
    const wav = path.join(dir, `line-${i}.wav`);
    // 줄 사이 짧은 쉼을 붙여 호흡을 만듭니다.
    await runOk("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-af", `apad=pad_dur=${gap}`, "-ar", "44100", "-ac", "1", wav]);
    const d = await probeDuration(wav);
    segments.push({ text, start: t, end: t + d - gap });
    t += d;
    parts.push(wav);
  }
  const list = path.join(dir, "concat.txt");
  writeFileSync(list, parts.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n"));
  const audio = path.join(dir, "narration.m4a");
  await runOk("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "aac", "-b:a", "160k", audio]);
  return { audio, segments };
}

/** 외부 음성 파일을 쓸 때: 길이를 줄 글자 수 비율로 나눠 자막 타이밍을 추정합니다. */
export function estimateSegments(lines: string[], total: number): Segment[] {
  const weights = lines.map((l) => Math.max(1, l.replace(/\s/g, "").length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return lines.map((text, i) => {
    const d = (total * weights[i]!) / sum;
    const seg = { text, start: t, end: t + d };
    t += d;
    return seg;
  });
}
