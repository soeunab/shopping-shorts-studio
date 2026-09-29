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

/** 한 줄이 너무 길면 가운데 공백에서 두 줄로 */
export function wrapLine(text: string, max = 16): string {
  if (text.length <= max) return text;
  const mid = Math.floor(text.length / 2);
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/**
 * 1080x1920 세로 영상용 자막. 대사는 화면 중하단(유튜브 UI 에 가리지 않는 위치),
 * 대가 표기는 상단에 영상 내내 표시합니다.
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
Style: Line,${font},84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,2,2,80,80,620,1
Style: Disclosure,${font},38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,3,0,0,8,60,60,110,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = [
    `Dialogue: 1,${assTime(0)},${assTime(total + 0.5)},Disclosure,,0,0,0,,${escapeAss(disclosure)}`,
    ...segments.map((s) => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Line,,0,0,0,,${escapeAss(wrapLine(s.text))}`),
  ];
  return `${header}\n${events.join("\n")}\n`;
}
