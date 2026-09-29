import type { Segment } from "./tts.js";

/** ASS 시간 형식 h:mm:ss.cc */
export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

const escapeAss = (t: string) => t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");

/** 한 줄 자막 최대 글자 수 (1080px 폭, 글자 크기 72 기준) */
export const MAX_CHARS = 13;

/** 대사를 한 줄에 들어가는 조각으로 나눕니다(띄어쓰기 기준, 너무 긴 어절은 그대로). */
export function chunkLine(text: string, max = MAX_CHARS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && next.length > max) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/** 대사 구간을 조각별 글자 수 비율로 나눠 한 줄씩 보여 줍니다. */
export function subtitleCues(segments: Segment[], max = MAX_CHARS): Segment[] {
  return segments.flatMap((s) => {
    const parts = chunkLine(s.text, max);
    const w = parts.map((p) => Math.max(1, p.replace(/\s/g, "").length));
    const sum = w.reduce((a, b) => a + b, 0);
    let t = s.start;
    return parts.map((text, i) => {
      const d = ((s.end - s.start) * w[i]!) / sum;
      const cue = { text, start: t, end: t + d };
      t += d;
      return cue;
    });
  });
}

/**
 * 1080x1920 세로 영상용 자막.
 * - 대사: 한 줄, 화면 위쪽 1/3 (하단은 플랫폼 UI·캡션에 가려짐)
 * - 대가 표기: 맨 위에 영상 내내
 */
export function buildAss(segments: Segment[], disclosure: string, font = process.env.SSS_FONT?.trim() || "Apple SD Gothic Neo"): string {
  const total = segments.at(-1)?.end ?? 0;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Line,${font},72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,3,8,60,60,500,1
Style: Disclosure,${font},36,&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,3,0,0,8,60,60,110,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = [
    `Dialogue: 1,${assTime(0)},${assTime(total + 0.5)},Disclosure,,0,0,0,,${escapeAss(disclosure)}`,
    ...subtitleCues(segments).map((s) => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Line,,0,0,0,,${escapeAss(s.text)}`),
  ];
  return `${header}\n${events.join("\n")}\n`;
}
