import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run, probeDuration, runOk } from "./exec.js";
import { googleSynthesize } from "./googleTts.js";

/**
 * 내레이션 음성 공급자 (SSS_TTS)
 * - google: Google Cloud TTS (기본, 무료 한도 안에서 무료, 자연스러운 한국어 뉴럴 음성)
 * - say:    macOS 내장 음성 (무료·오프라인, Yuna 프리미엄/향상 음성이 있으면 자동 선택)
 * - file:   직접 녹음하거나 다른 도구로 만든 파일 (`render --voice 파일`)
 */
export type Provider = "google" | "say";
export type Segment = { text: string; start: number; end: number };

export function providerFromEnv(): Provider {
  return process.env.SSS_TTS?.trim() === "say" ? "say" : "google";
}

/** `say -v ?` 목록에서 가장 좋은 한국어 음성: 프리미엄 > 향상 > 기본 Yuna */
export function pickSayVoice(list: string): string {
  const lines = list.split("\n");
  const ko = lines.filter((l) => /\bko_KR\b/.test(l)).map((l) => l.replace(/\s+ko_KR.*$/, "").trim());
  return ko.find((n) => /Premium|프리미엄/.test(n)) ?? ko.find((n) => /Enhanced|향상/.test(n)) ?? ko[0] ?? "Yuna";
}

export async function bestSayVoice(): Promise<string> {
  if (process.env.SSS_VOICE?.trim()) return process.env.SSS_VOICE.trim();
  const r = await run("say", ["-v", "?"]).catch(() => null);
  return r?.code === 0 ? pickSayVoice(r.stdout) : "Yuna";
}

export function sayArgs(text: string, out: string, voice: string, rate = process.env.SSS_VOICE_RATE?.trim() || "200"): string[] {
  return ["-v", voice, "-r", rate, "-o", out, "--data-format=LEI16@44100", text];
}

/** atempo 는 0.5~2.0 범위에서 피치를 유지한 채 속도만 바꿉니다. */
export function tempoFilter(speed: number): string | null {
  if (!Number.isFinite(speed) || Math.abs(speed - 1) < 0.001) return null;
  return `atempo=${Math.min(2, Math.max(0.5, speed)).toFixed(3)}`;
}

/** 대사를 한 줄씩 합성 → 이어 붙이고, 줄별 시작·끝 시간을 돌려줍니다(자막 타이밍이 정확). */
export async function synthesize(lines: string[], dir: string, opts: { provider?: Provider; speed?: number; gap?: number } = {}): Promise<{ audio: string; segments: Segment[] }> {
  const provider = opts.provider ?? providerFromEnv();
  const speed = opts.speed ?? 1;
  const gap = opts.gap ?? 0.12;
  mkdirSync(dir, { recursive: true });
  const voice = provider === "say" ? await bestSayVoice() : undefined;
  const parts: string[] = [];
  const segments: Segment[] = [];
  let t = 0;
  for (const [i, text] of lines.entries()) {
    const raw = path.join(dir, `line-${i}.raw.${provider === "say" ? "aiff" : "wav"}`);
    if (provider === "google") await googleSynthesize(text, raw, { speakingRate: speed });
    else await runOk("say", sayArgs(text, raw, voice!));
    const wav = path.join(dir, `line-${i}.wav`);
    // google 은 speakingRate 로 이미 속도 반영 → say 만 atempo
    const filters = [provider === "say" ? tempoFilter(speed) : null, TRIM_EDGES, `apad=pad_dur=${gap}`].filter(Boolean).join(",");
    await runOk("ffmpeg", ["-y", "-v", "error", "-i", raw, "-af", filters, "-ar", "44100", "-ac", "1", wav]);
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

/** 앞뒤 무음 제거 */
const TRIM_EDGES = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse";

/** 외부 음성 파일: 앞뒤 무음 제거 + 속도 조절 후, 숨 쉬는 구간(무음)에 맞춰 자막 타이밍을 잡습니다. */
export async function prepareExternalVoice(file: string, lines: string[], dir: string, speed = 1): Promise<{ audio: string; segments: Segment[] }> {
  mkdirSync(dir, { recursive: true });
  const audio = path.join(dir, "narration.m4a");
  const filters = [TRIM_EDGES, tempoFilter(speed)].filter(Boolean).join(",");
  await runOk("ffmpeg", ["-y", "-v", "error", "-i", file, "-af", filters, "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "160k", audio]);
  const total = await probeDuration(audio);
  const r = await run("ffmpeg", ["-hide_banner", "-i", audio, "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"]);
  return { audio, segments: alignToPauses(lines, total, parseSilences(r.stderr)) };
}

export type Pause = { start: number; end: number };

export function parseSilences(stderr: string): Pause[] {
  const out: Pause[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    if (s) start = Number(s[1]);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  return out;
}

/** 글자 수 비율로 줄별 시간을 추정합니다. */
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

/**
 * 추정한 줄 경계마다 가장 가까운 무음 구간(허용 오차 안)으로 옮깁니다.
 * 자막이 말하는 중간에 바뀌지 않고 숨 쉬는 곳에서 바뀌게 됩니다.
 */
export function alignToPauses(lines: string[], total: number, pauses: Pause[], tolerance = 1.2): Segment[] {
  const est = estimateSegments(lines, total);
  const bounds: number[] = [];
  let prev = 0;
  for (let i = 0; i < est.length - 1; i++) {
    const target = est[i]!.end;
    const candidates = pauses.map((p) => (p.start + p.end) / 2).filter((m) => m > prev + 0.3 && Math.abs(m - target) <= tolerance);
    const best = candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    const b = best ?? Math.max(target, prev + 0.3);
    bounds.push(b);
    prev = b;
  }
  return lines.map((text, i) => ({ text, start: i === 0 ? 0 : bounds[i - 1]!, end: i === lines.length - 1 ? total : bounds[i]! }));
}
