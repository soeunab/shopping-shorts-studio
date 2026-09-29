import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../config.js";
import type { ShortRow } from "../db.js";
import { COUPANG_DISCLOSURE, selectedHook, SHOPPING_CONNECT_DISCLOSURE, type Script } from "../script/generate.js";
import { containsKeyword } from "../script/seo.js";

/**
 * 폰에서 올리기 위한 플랫폼별 캡션.
 * 참고: 유튜브 쇼츠 설명·댓글의 링크, 인스타 캡션의 링크는 눌리지 않습니다 →
 * 링크는 프로필(링크인바이오)이나 인스타 댓글 키워드 DM 자동응답(ManyChat 등 Meta 공식 파트너)으로 안내합니다.
 */
export type ExportPlatform = "instagram" | "youtube" | "tiktok" | "naver";

/** 받침에 맞는 조사: "정리" → "가", "냄새 제거" → "가", "수납" → "이" */
export function josaIGa(word: string): "이" | "가" {
  const c = word.trim().at(-1)?.charCodeAt(0) ?? 0;
  if (c < 0xac00 || c > 0xd7a3) return "가";
  return (c - 0xac00) % 28 ? "이" : "가";
}

/** 캡션 속 키워드 문장 — 인스타·틱톡·유튜브 검색은 캡션 문장 속 단어도 봅니다. */
export function keywordSentence(script: Script): string {
  const [main, ...rest] = script.searchKeywords;
  if (!main) return "";
  const more = rest.slice(0, 2);
  return `${main}${josaIGa(main)} 고민이라면 참고하세요.${more.length ? ` (${more.join(", ")})` : ""}`;
}

/** 플랫폼별 해시태그: 유튜브는 제목 위에 앞 3개가 보이므로 검색성 높은 중간·구체 태그를 앞에 */
export function platformTags(script: Script, platform: ExportPlatform): string[] {
  const { broad, mid, specific } = script.hashtags;
  if (platform === "youtube") return [...new Set([...mid, ...specific, ...broad])].slice(0, 3);
  return [...new Set([...broad, ...mid, ...specific])].slice(0, 5);
}

export function buildCaptions(short: Pick<ShortRow, "naverUrl">, script: Script): Record<ExportPlatform, string> {
  const title = script.titles[0] ?? "";
  const kw = script.commentKeyword;
  const hook = selectedHook(script);
  const main = script.searchKeywords[0];
  const firstLine = `[광고] ${hook}${main && !containsKeyword(hook, main) ? ` | ${main}` : ""}`;
  const sentence = keywordSentence(script);
  const tags = (p: ExportPlatform) => platformTags(script, p).join(" ");
  const naverDisclosure = short.naverUrl ? SHOPPING_CONNECT_DISCLOSURE : COUPANG_DISCLOSURE;
  const lines = (...xs: (string | false)[]) => xs.filter((x): x is string => x !== false).join("\n").replace(/\n{3,}/g, "\n\n");
  return {
    // 첫 줄(더보기 전)에 광고 표기 + 훅 + 키워드
    instagram: lines(
      firstLine,
      COUPANG_DISCLOSURE,
      "",
      !!sentence && sentence,
      "",
      `📌 댓글에 '${kw}' 남기면 제품 링크를 DM으로 보내드려요.`,
      "필요할 때 보게 저장하고, 필요한 사람에게 보내 주세요.",
      "",
      tags("instagram"),
    ),
    youtube: lines(
      `[제목] ${title}`,
      "",
      "[설명]",
      COUPANG_DISCLOSURE,
      !!sentence && sentence,
      "제품 정보는 채널 프로필 링크에서 확인하세요.",
      "",
      tags("youtube"),
      "",
      "[고정 댓글]",
      `제품 정보는 채널 프로필 링크에 있어요. 필요한 분께 공유해 주세요. (${kw})`,
    ),
    tiktok: lines(firstLine, COUPANG_DISCLOSURE, "", !!sentence && sentence, "제품 정보는 프로필 링크에서.", "", tags("tiktok")),
    naver: lines(
      `[제목] ${title}`,
      "",
      naverDisclosure,
      !!sentence && sentence,
      short.naverUrl ? "쇼핑커넥트 상품을 클립에 연결하세요." : "쇼핑커넥트 링크가 없어요 — 네이버 클립은 쇼핑커넥트 상품 연결을 권장합니다.",
      "",
      [...platformTags(script, "naver"), ...script.searchKeywords.slice(0, 2).map((k) => `#${k.replace(/\s+/g, "")}`)].filter((t, i, a) => a.indexOf(t) === i).join(" "),
    ),
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
