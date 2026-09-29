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

/** 대사 구간을 조각별 글자 수 비율로 나눠 한 줄씩 보여 줍니다. seg 는 원래 대사 번호. */
export function subtitleCues(segments: Segment[], max = MAX_CHARS): (Segment & { seg: number })[] {
  return segments.flatMap((s, seg) => {
    const parts = chunkLine(s.text, max);
    const w = parts.map((p) => Math.max(1, p.replace(/\s/g, "").length));
    const sum = w.reduce((a, b) => a + b, 0);
    let t = s.start;
    return parts.map((text, i) => {
      const d = ((s.end - s.start) * w[i]!) / sum;
      const cue = { text, start: t, end: t + d, seg };
      t += d;
      return cue;
    });
  });
}

/** 강조색(노랑). ASS 색은 &HBBGGRR& 순서 */
export const EMPHASIS_COLOR = "&H00FFFF&";
/** 첫 화면 제목 카드 표시 시간(초) */
export const TITLE_CARD_SECONDS = 1.5;

/** 자막 한 줄에서 강조 단어(첫 번째 한 곳)를 노란색으로 */
export function emphasize(escapedText: string, word?: string): string {
  if (!word) return escapedText;
  const w = escapeAss(word);
  const i = escapedText.indexOf(w);
  if (i < 0) return escapedText;
  return `${escapedText.slice(0, i)}{\\1c${EMPHASIS_COLOR}}${w}{\\1c&HFFFFFF&}${escapedText.slice(i + w.length)}`;
}

export type AssOptions = {
  /** 첫 1.5초 화면 제목 카드(검색 키워드 포함 헤드라인) */
  titleCard?: string;
  /** 대사 번호별 강조 단어 */
  emphasis?: (string | undefined)[];
  font?: string;
};

/**
 * 1080x1920 세로 영상용 자막. 위에서부터:
 * - 대가 표기(y≈110): 영상 내내
 * - 제목 카드(y≈260~400): 첫 1.5초, 큰 글씨·반투명 박스
 * - 대사(y≈500~): 한 줄, 화면 위쪽 1/3 (하단 20%·오른쪽 버튼은 플랫폼 UI 에 가려짐)
 */
export function buildAss(segments: Segment[], disclosure: string, opts: AssOptions = {}): string {
  const font = opts.font ?? (process.env.SSS_FONT?.trim() || "Apple SD Gothic Neo");
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
Style: Title,${font},96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,1,0,0,0,100,100,0,0,3,18,0,8,60,60,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = [
    `Dialogue: 1,${assTime(0)},${assTime(total + 0.5)},Disclosure,,0,0,0,,${escapeAss(disclosure)}`,
    ...(opts.titleCard ? [`Dialogue: 2,${assTime(0)},${assTime(TITLE_CARD_SECONDS)},Title,,0,0,0,,${escapeAss(opts.titleCard)}`] : []),
    ...subtitleCues(segments).map((s) => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Line,,0,0,0,,${emphasize(escapeAss(s.text), opts.emphasis?.[s.seg])}`),
  ];
  return `${header}\n${events.join("\n")}\n`;
}
