import { z } from "zod";
import { checkProductPrompt } from "../ai/runway.js";

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
  AI_FROM_PRODUCT: "실제 상품 이미지를 AI로 움직인 영상(카메라 모션만)",
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

/**
 * 장면 역할 — 대사 구간에 맞춰 배치됩니다.
 * HOOK: 첫 2초 / PROBLEM: 불편한 상황 / PRODUCT: 실제 상품 / CONTEXT: 분위기·사용 장소
 */
export const ROLES = {
  HOOK: "첫 2초 훅",
  PROBLEM: "문제 상황",
  PRODUCT: "실제 상품",
  CONTEXT: "분위기·장소",
} as const;
export type Role = keyof typeof ROLES;

/** 실제 상품 장면에 쓸 수 있는 소스 — 실물과 다른 AI·스톡 이미지를 상품처럼 보여 주지 않기 위함 */
export const PRODUCT_KINDS: SourceKind[] = ["PRODUCT_IMAGE", "AI_FROM_PRODUCT", "PERMISSION", "OWN"];
/** AI 가 만든 장면 — 업로드할 때 플랫폼의 AI 콘텐츠 표시가 필요 */
export const AI_KINDS: SourceKind[] = ["AI", "AI_FROM_PRODUCT"];

export const ClipSchema = z.object({
  file: z.string().min(1),
  kind: z.enum(Object.keys(SOURCE_KINDS) as [SourceKind, ...SourceKind[]]),
  role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]).default("CONTEXT"),
  /** 출처 URL (스톡·허락·상품 이미지는 필수) */
  sourceUrl: z.string().url().optional(),
  /** 라이선스·허락 근거 (허락 메일 파일 경로, 라이선스 이름 등) */
  proof: z.string().optional(),
  note: z.string().optional(),
  /** AI 생성 소스: 사용한 프롬프트·모델·원본 이미지 */
  prompt: z.string().optional(),
  model: z.string().optional(),
  derivedFrom: z.string().optional(),
});
export type Clip = z.infer<typeof ClipSchema>;
export type ClipInput = z.input<typeof ClipSchema>;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const matchesHost = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** 문제가 없으면 빈 배열, 있으면 한국어 사유 목록 */
export function checkClip(input: ClipInput): string[] {
  const clip = ClipSchema.parse(input);
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
    case "AI_FROM_PRODUCT":
      if (!clip.derivedFrom) problems.push(`${clip.file}: 원본 상품 이미지(derivedFrom)가 기록돼 있지 않아요.`);
      if (!clip.sourceUrl) problems.push(`${clip.file}: 원본 상품 이미지의 출처 URL 이 필요해요.`);
      if (!clip.proof) problems.push(`${clip.file}: 원본 상품 이미지의 사용 가능 근거(proof)가 필요해요.`);
      if (!clip.prompt) problems.push(`${clip.file}: 생성 프롬프트가 기록돼 있지 않아요.`);
      else problems.push(...checkProductPrompt(clip.prompt).map((p) => `${clip.file}: ${p}`));
      break;
    case "OWN":
    case "AI":
      break;
  }
  if (clip.role === "PRODUCT" && !PRODUCT_KINDS.includes(clip.kind)) {
    problems.push(`${clip.file}: '실제 상품' 장면에는 상품 이미지·허락 영상·직접 촬영만 쓸 수 있어요. ${SOURCE_KINDS[clip.kind]}는 PROBLEM·CONTEXT 역할로 등록하세요.`);
  }
  return problems;
}

export function checkClips(clips: ClipInput[]): string[] {
  if (!clips.length) return ["등록된 영상 소스가 없어요. `sss clip add` 로 추가하세요."];
  return clips.flatMap(checkClip);
}
