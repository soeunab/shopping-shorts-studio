import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../config.js";
import type { ShortRow } from "../db.js";
import { COUPANG_DISCLOSURE, SHOPPING_CONNECT_DISCLOSURE, type Script } from "../script/generate.js";

/**
 * 폰에서 올리기 위한 플랫폼별 캡션.
 * 참고: 유튜브 쇼츠 설명·댓글의 링크, 인스타 캡션의 링크는 눌리지 않습니다 →
 * 링크는 프로필(링크인바이오)이나 인스타 댓글 키워드 DM 자동응답(ManyChat 등 Meta 공식 파트너)으로 안내합니다.
 */
export type ExportPlatform = "instagram" | "youtube" | "tiktok" | "naver";

const tags = (s: Script) => s.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");

export function buildCaptions(short: Pick<ShortRow, "naverUrl">, script: Script): Record<ExportPlatform, string> {
  const title = script.titles[0] ?? "";
  const kw = script.commentKeyword;
  const naverDisclosure = short.naverUrl ? SHOPPING_CONNECT_DISCLOSURE : COUPANG_DISCLOSURE;
  return {
    instagram: [COUPANG_DISCLOSURE, "", title, "", `📌 댓글에 '${kw}' 남기면 제품 링크를 DM으로 보내드려요.`, "필요할 때 보게 저장해 두세요.", "", tags(script)].join("\n"),
    youtube: [
      `[제목] ${title} #shorts`,
      "",
      "[설명]",
      COUPANG_DISCLOSURE,
      "",
      "제품 정보는 채널 프로필 링크에서 확인하세요.",
      "",
      tags(script),
      "",
      "[고정 댓글]",
      `제품 정보는 채널 프로필 링크에 있어요. (${kw})`,
    ].join("\n"),
    tiktok: [COUPANG_DISCLOSURE, "", title, "", "제품 정보는 프로필 링크에서.", "", tags(script)].join("\n"),
    naver: [naverDisclosure, "", title, "", short.naverUrl ? "쇼핑커넥트 상품을 클립에 연결하세요." : "쇼핑커넥트 링크가 없어요 — 네이버 클립은 쇼핑커넥트 상품 연결을 권장합니다.", "", tags(script)].join("\n"),
  };
}

export function buildLinks(short: Pick<ShortRow, "productName" | "productUrl" | "naverUrl">, script: Script): string {
  return [
    `제품: ${short.productName}`,
    `쿠팡파트너스: ${short.productUrl ?? "(없음 — new --url 로 등록)"}`,
    `쇼핑커넥트: ${short.naverUrl ?? "(없음 — new --naver-url 로 등록)"}`,
    `인스타 댓글 키워드: ${script.commentKeyword}`,
    "",
    "할 일:",
    "- 프로필 링크(링크트리 등)에 쿠팡 링크 추가",
    `- ManyChat 등에서 댓글 '${script.commentKeyword}' → DM 으로 쿠팡 링크 자동 발송 설정`,
    "- 인스타: '브랜드 콘텐츠/유료 파트너십' 표시, 틱톡: '콘텐츠 공개 → 브랜드 콘텐츠' 켜기",
    "- 유튜브: 세부정보 → '유료 프로모션 포함' 체크",
    "- AI 이미지가 들어갔다면 각 플랫폼의 'AI 생성 콘텐츠' 표시 켜기",
  ].join("\n");
}

export function exportDir(id: number): string {
  return path.join(process.env.SSS_EXPORT_DIR?.trim() || path.join(dataDir(), "exports"), String(id));
}

export function writeExport(short: ShortRow, script: Script): string {
  if (!short.videoPath) throw new Error("렌더된 영상이 없어요. 먼저 render 하세요.");
  const dir = exportDir(short.id);
  mkdirSync(dir, { recursive: true });
  copyFileSync(short.videoPath, path.join(dir, `short-${short.id}.mp4`));
  for (const [platform, text] of Object.entries(buildCaptions(short, script))) writeFileSync(path.join(dir, `${platform}.txt`), text + "\n");
  writeFileSync(path.join(dir, "links.txt"), buildLinks(short, script) + "\n");
  return dir;
}
