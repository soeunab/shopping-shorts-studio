import { writeFileSync } from "node:fs";

/**
 * Google Cloud Text-to-Speech — 공식 서비스, 생성 음성의 상업 이용 가능, 월 무료 한도 안에서 무료.
 * (무료 한도·음성 종류는 https://cloud.google.com/text-to-speech/pricing 에서 확인)
 * 설정: 구글 클라우드 콘솔 → Text-to-Speech API 사용 설정 → API 키 발급(Text-to-Speech 로 제한 권장) → GOOGLE_TTS_API_KEY
 */
export const DEFAULT_GOOGLE_VOICE = "ko-KR-Neural2-A";

export function googleTtsBody(text: string, voice: string, speakingRate: number) {
  return {
    input: { text },
    voice: { languageCode: "ko-KR", name: voice },
    audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 44100, speakingRate },
  };
}

export async function googleSynthesize(text: string, out: string, opts: { voice?: string; speakingRate?: number; key?: string } = {}): Promise<void> {
  const key = opts.key ?? process.env.GOOGLE_TTS_API_KEY?.trim();
  if (!key) throw new Error("GOOGLE_TTS_API_KEY 가 필요해요. README '무료 음성' 참고, 또는 SSS_TTS=say 로 맥 음성을 쓰세요.");
  const voice = opts.voice ?? (process.env.SSS_TTS_VOICE?.trim() || DEFAULT_GOOGLE_VOICE);
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(googleTtsBody(text, voice, opts.speakingRate ?? 1)),
  });
  const json = (await res.json()) as { audioContent?: string; error?: { message?: string } };
  if (!res.ok || !json.audioContent) throw new Error(`Google TTS 실패: ${json.error?.message ?? res.status}`);
  // LINEAR16 응답은 WAV 헤더가 포함된 바이트입니다.
  writeFileSync(out, Buffer.from(json.audioContent, "base64"));
}
