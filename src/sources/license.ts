import { z } from "zod";

/**
 * 영상 소스 라이선스 검증 — 이 프로젝트의 핵심 안전장치.
 *
 * 허용 소스만 렌더에 들어갈 수 있습니다. 다른 사람이 올린 도우인·틱톡·유튜브 영상을
 * 내려받아 재편집하는 경로는 만들지 않습니다(저작권 침해, 플랫폼 재사용 정책 위반).
 */
export const SOURCE_KINDS = {
  OWN: "직접 촬영",
  STOCK: "라이선스 무료 영상/이미지 (Pexels·Pixabay 등)",
  PERMISSION: "판매자·제조사 사용 허락",
  AI: "AI 생성 이미지/영상",
  PRODUCT_IMAGE: "제휴 프로그램이 홍보용으로 제공한 상품 이미지",
} as const;

export type SourceKind = keyof typeof SOURCE_KINDS;

/** 상업적 이용이 가능하다고 확인된 스톡 사이트 */
export const STOCK_HOSTS = ["pexels.com", "pixabay.com"];

/** 다른 사람의 업로드 영상을 가져오는 곳 — 출처로 입력되면 거부 */
export const BLOCKED_HOSTS = [
  "douyin.com",
  "iesdouyin.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "kuaishou.com",
  "xiaohongshu.com",
  "xhslink.com",
  "bilibili.com",
  "facebook.com",
  "ixigua.com",
];

export const ClipSchema = z.object({
  file: z.string().min(1),
  kind: z.enum(Object.keys(SOURCE_KINDS) as [SourceKind, ...SourceKind[]]),
  /** 출처 URL (스톡·허락·상품 이미지는 필수) */
  sourceUrl: z.string().url().optional(),
  /** 라이선스·허락 근거 (허락 메일 파일 경로, 라이선스 이름 등) */
  proof: z.string().optional(),
  note: z.string().optional(),
});
export type Clip = z.infer<typeof ClipSchema>;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const matchesHost = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** 문제가 없으면 빈 배열, 있으면 한국어 사유 목록 */
export function checkClip(clip: Clip): string[] {
  const problems: string[] = [];
  const host = clip.sourceUrl ? hostOf(clip.sourceUrl) : null;

  if (host && matchesHost(host, BLOCKED_HOSTS)) {
    problems.push(`${clip.file}: ${host} 의 다른 사람 영상은 쓸 수 없어요. 직접 촬영·스톡·허락받은 소스로 바꿔 주세요.`);
  }
  switch (clip.kind) {
    case "STOCK":
      if (!clip.sourceUrl) problems.push(`${clip.file}: 스톡 소스는 원본 페이지 URL 이 필요해요.`);
      else if (host && !matchesHost(host, STOCK_HOSTS)) {
        problems.push(`${clip.file}: ${host} 는 확인된 스톡 사이트가 아니에요(${STOCK_HOSTS.join(", ")}). 허락을 받았다면 PERMISSION 으로 등록하세요.`);
      }
      break;
    case "PERMISSION":
      if (!clip.proof) problems.push(`${clip.file}: 사용 허락 근거(proof: 메일·계약 파일 경로 등)가 필요해요.`);
      break;
    case "PRODUCT_IMAGE":
      if (!clip.sourceUrl) problems.push(`${clip.file}: 상품 이미지의 출처 URL 이 필요해요.`);
      if (!clip.proof) problems.push(`${clip.file}: 제휴 프로그램 약관상 사용 가능 근거(proof)를 적어 주세요.`);
      break;
    case "OWN":
    case "AI":
      break;
  }
  return problems;
}

export function checkClips(clips: Clip[]): string[] {
  if (!clips.length) return ["등록된 영상 소스가 없어요. `sss clip add` 로 추가하세요."];
  return clips.flatMap(checkClip);
}
