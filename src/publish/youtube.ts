import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * 유튜브 업로드 — 항상 "비공개"로 올립니다. 공개 전환은 사람이 `sss approve` 한 쇼츠만 `sss publish` 로.
 * OAuth 는 구글 클라우드 콘솔의 "데스크톱 앱" 클라이언트(YT_CLIENT_ID / YT_CLIENT_SECRET)로 로컬에서 받습니다.
 * 참고: API 검수(감사)를 받지 않은 프로젝트로 올린 영상은 유튜브가 비공개로 잠급니다 → 그 경우 스튜디오에서 직접 공개하세요.
 */
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const TOKEN_FILE = () => path.resolve(process.env.SSS_SECRETS?.trim() || "secrets", "youtube-token.json");

type Token = { access_token: string; refresh_token?: string; expires_at: number };

function client() {
  const id = process.env.YT_CLIENT_ID?.trim();
  const secret = process.env.YT_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("YT_CLIENT_ID / YT_CLIENT_SECRET 환경변수가 필요해요(.env). README 의 '유튜브 연결'을 보세요.");
  return { id, secret };
}

async function tokenRequest(body: Record<string, string>): Promise<Token & { refresh_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams(body) });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`구글 토큰 요청 실패: ${json.error_description ?? json.error ?? res.status}`);
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 };
}

/** 브라우저로 구글 로그인 → 127.0.0.1 로 코드를 받아 토큰 저장 */
export async function authorize(port = 53682): Promise<void> {
  const { id, secret } = client();
  const redirect = `http://127.0.0.1:${port}/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  })}`;
  console.log(`브라우저에서 아래 주소를 열어 유튜브 채널 계정으로 로그인하세요:\n${url}\n`);
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", redirect);
      const c = u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(c ? "연결됐어요. 이 창을 닫아도 됩니다." : "코드가 없어요.");
      server.close();
      c ? resolve(c) : reject(new Error(u.searchParams.get("error") ?? "인증 취소"));
    }).listen(port, "127.0.0.1");
  });
  const token = await tokenRequest({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" });
  mkdirSync(path.dirname(TOKEN_FILE()), { recursive: true });
  writeFileSync(TOKEN_FILE(), JSON.stringify(token, null, 2), { mode: 0o600 });
  console.log(`✅ 토큰 저장: ${TOKEN_FILE()}`);
}

async function accessToken(): Promise<string> {
  if (!existsSync(TOKEN_FILE())) throw new Error("유튜브 연결이 필요해요: npm run sss -- youtube auth");
  const saved = JSON.parse(readFileSync(TOKEN_FILE(), "utf8")) as Token;
  if (saved.expires_at > Date.now()) return saved.access_token;
  if (!saved.refresh_token) throw new Error("갱신 토큰이 없어요. 다시 연결하세요: npm run sss -- youtube auth");
  const { id, secret } = client();
  const fresh = await tokenRequest({ refresh_token: saved.refresh_token, client_id: id, client_secret: secret, grant_type: "refresh_token" });
  writeFileSync(TOKEN_FILE(), JSON.stringify({ ...saved, ...fresh, refresh_token: saved.refresh_token }, null, 2), { mode: 0o600 });
  return fresh.access_token;
}

export type UploadMeta = { title: string; description: string; tags: string[]; syntheticMedia: boolean };

export function uploadBody(meta: UploadMeta) {
  return {
    snippet: { title: meta.title.slice(0, 100), description: meta.description.slice(0, 5000), tags: meta.tags, categoryId: "26", defaultLanguage: "ko" },
    status: {
      privacyStatus: "private" as const,
      selfDeclaredMadeForKids: false,
      // AI 로 만든 사실적인 장면이 들어가면 유튜브 정책상 표시해야 합니다.
      containsSyntheticMedia: meta.syntheticMedia,
    },
  };
}

/** 재개 가능 업로드(resumable) — 비공개 고정 */
export async function uploadPrivate(file: string, meta: UploadMeta): Promise<{ videoId: string; url: string }> {
  const token = await accessToken();
  const size = statSync(file).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(size),
    },
    body: JSON.stringify(uploadBody(meta)),
  });
  const location = init.headers.get("location");
  if (!init.ok || !location) throw new Error(`업로드 시작 실패: ${init.status} ${(await init.text()).slice(0, 300)}`);
  const put = await fetch(location, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "video/mp4", "content-length": String(size) },
    body: Readable.toWeb(createReadStream(file)) as ReadableStream,
    duplex: "half",
  } as RequestInit);
  const json = (await put.json()) as { id?: string; error?: { message?: string } };
  if (!put.ok || !json.id) throw new Error(`업로드 실패: ${json.error?.message ?? put.status}`);
  return { videoId: json.id, url: `https://youtube.com/shorts/${json.id}` };
}

/** 사람이 승인한 쇼츠만 호출됩니다(cli 에서 상태 확인). */
export async function makePublic(videoId: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ id: videoId, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } }),
  });
  if (!res.ok) throw new Error(`공개 전환 실패: ${res.status} ${(await res.text()).slice(0, 300)} — 유튜브 스튜디오에서 직접 공개하세요.`);
}

export function videoIdOf(url: string): string | null {
  return url.match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
}
