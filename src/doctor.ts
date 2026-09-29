import { claudeBin } from "./llm/claudeCode.js";
import { run } from "./media/exec.js";
import { pickSayVoice, providerFromEnv } from "./media/tts.js";
import { channelCategory } from "./product/score.js";

/** optional: 없어도 되는 항목(❌ 대신 ➖ 로 표시) */
type Check = { name: string; ok: boolean; detail: string; fix?: string; optional?: boolean };

async function tryRun(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await run(cmd, args, { timeoutMs: 15_000 });
    return { ok: r.code === 0, out: r.stdout + r.stderr };
  } catch (e) {
    return { ok: false, out: (e as Error).message };
  }
}

/** 맥미니에서 필요한 도구·키가 준비됐는지 확인 */
export async function doctor(): Promise<Check[]> {
  const checks: Check[] = [];
  const [major, minor] = process.versions.node.split(".").map(Number);
  checks.push({ name: "Node.js", ok: major! > 22 || (major === 22 && minor! >= 13), detail: process.versions.node, fix: "brew install node (22.13 이상, node:sqlite 사용)" });

  const ff = await tryRun("ffmpeg", ["-hide_banner", "-version"]);
  checks.push({ name: "ffmpeg", ok: ff.ok, detail: ff.ok ? ff.out.split("\n")[0]! : "없음", fix: "brew install ffmpeg" });
  if (ff.ok) {
    const filters = await tryRun("ffmpeg", ["-hide_banner", "-filters"]);
    checks.push({ name: "ffmpeg 자막(libass)", ok: /\bsubtitles\b/.test(filters.out), detail: "subtitles 필터", fix: "brew reinstall ffmpeg (libass 포함 빌드)" });
    const enc = await tryRun("ffmpeg", ["-hide_banner", "-encoders"]);
    checks.push({ name: "하드웨어 인코더", ok: /h264_videotoolbox/.test(enc.out), detail: "h264_videotoolbox (없으면 libx264 로 대체)", optional: true });
  }
  const probe = await tryRun("ffprobe", ["-version"]);
  checks.push({ name: "ffprobe", ok: probe.ok, detail: probe.ok ? "있음" : "없음", fix: "brew install ffmpeg" });

  const provider = providerFromEnv();
  checks.push({
    name: "음성: Google TTS 키",
    ok: !!process.env.GOOGLE_TTS_API_KEY,
    detail: provider === "google" ? "GOOGLE_TTS_API_KEY (현재 기본 음성)" : "GOOGLE_TTS_API_KEY (SSS_TTS=say 사용 중)",
    fix: "README '무료 음성' 참고 — 또는 .env 에 SSS_TTS=say",
    optional: provider !== "google",
  });
  const voices = await tryRun("say", ["-v", "?"]);
  const best = voices.ok ? pickSayVoice(voices.out) : null;
  checks.push({
    name: "음성: 맥 한국어 음성",
    ok: !!best && /\(/.test(best),
    detail: voices.ok ? `${best}${/\(/.test(best ?? "") ? "" : " (기본 음질)"}` : "say 없음(맥이 아님)",
    fix: "시스템 설정 → 손쉬운 사용 → 읽기 및 말하기 → 시스템 음성 → 음성 관리 → 한국어 Yuna (프리미엄/향상) 다운로드",
    optional: provider !== "say",
  });

  checks.push({ name: "스톡: Pexels 키", ok: !!process.env.PEXELS_API_KEY, detail: "PEXELS_API_KEY (stock 명령)", fix: "https://www.pexels.com/api/ 에서 무료 발급", optional: true });
  checks.push({ name: "채널 카테고리", ok: true, detail: channelCategory() });

  const bin = claudeBin();
  checks.push({ name: "Claude Code", ok: !!bin, detail: bin ?? "없음", fix: "Claude Code 설치 후 claude 실행 → /login (구독 계정)" });
  checks.push({
    name: "유튜브 OAuth (선택)",
    ok: !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET),
    detail: "YT_CLIENT_ID / YT_CLIENT_SECRET — API 업로드할 때만",
    optional: true,
  });
  return checks;
}
