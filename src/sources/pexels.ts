import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Pexels 무료 스톡 영상 검색 — 상업적 이용 가능(Pexels 라이선스), 원본 페이지 URL 을 함께 기록합니다.
 * 키 발급: https://www.pexels.com/api/ (무료) → .env 의 PEXELS_API_KEY
 */
export type PexelsFile = { link: string; width: number; height: number; file_type: string; quality?: string | null };
export type PexelsVideo = { id: number; url: string; duration: number; width: number; height: number; user?: { name?: string }; video_files: PexelsFile[] };

/** 세로 영상 중 1080x1920 에 가장 가까운 mp4 (너무 큰 4K 는 피함) */
export function pickPexelsFile(v: PexelsVideo): PexelsFile | null {
  const portrait = v.video_files.filter((f) => f.file_type === "video/mp4" && f.height > f.width && f.height >= 1280);
  if (!portrait.length) return null;
  return portrait.sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0]!;
}

export async function searchPexels(query: string, opts: { perPage?: number; key?: string } = {}): Promise<PexelsVideo[]> {
  const key = opts.key ?? process.env.PEXELS_API_KEY?.trim();
  if (!key) throw new Error("PEXELS_API_KEY 가 필요해요(무료 발급: https://www.pexels.com/api/).");
  const url = `https://api.pexels.com/videos/search?${new URLSearchParams({ query, orientation: "portrait", size: "medium", per_page: String(opts.perPage ?? 15) })}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels 검색 실패: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { videos?: PexelsVideo[] }).videos ?? [];
}

/** 다른 쇼츠에서 이미 쓴 영상은 건너뛰어 채널 안 중복을 줄입니다. */
export function chooseVideos(videos: PexelsVideo[], usedUrls: Set<string>, count: number): { video: PexelsVideo; file: PexelsFile }[] {
  const out: { video: PexelsVideo; file: PexelsFile }[] = [];
  for (const v of videos) {
    if (out.length >= count) break;
    if (usedUrls.has(v.url)) continue;
    const file = pickPexelsFile(v);
    if (file) out.push({ video: v, file });
  }
  return out;
}

export async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`다운로드 실패: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}
