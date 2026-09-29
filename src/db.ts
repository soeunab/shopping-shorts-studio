import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "./config.js";
import type { Scores } from "./product/score.js";

/**
 * 상태 흐름: DRAFT → SCRIPTED → RENDERED → EXPORTED(폰 업로드용 파일) → APPROVED(사람 검수) → PUBLISHED(올림)
 * 유튜브 API 경로: RENDERED/EXPORTED → PRIVATE(비공개 업로드) → APPROVED → PUBLISHED
 */
export type ShortStatus = "DRAFT" | "SCRIPTED" | "RENDERED" | "EXPORTED" | "PRIVATE" | "APPROVED" | "PUBLISHED";

export type ShortRow = {
  id: number;
  productName: string;
  /** 쿠팡파트너스 링크 */
  productUrl: string | null;
  /** 네이버 쇼핑커넥트 링크 */
  naverUrl: string | null;
  category: string | null;
  program: "COUPANG" | "SHOPPING_CONNECT";
  facts: string[];
  scores: Scores | null;
  status: ShortStatus;
  script: unknown | null;
  clips: unknown[];
  videoPath: string | null;
  remoteUrl: string | null;
  /** 제작에 쓴 시간(분) — 시간당 수익 계산용 */
  minutes: number;
  /** AI 영상 생성에 쓴 크레딧(Runway 1크레딧 = $0.01) */
  aiCredits: number;
  /** 성과 비교용: 고른 훅 유형·제목·대표 검색 키워드·올린 시각 */
  hookType: string | null;
  title: string | null;
  keyword: string | null;
  postedAt: string | null;
  createdAt: string;
};

type Raw = Record<string, string | number | null>;

const parseJson = <T>(v: string | number | null | undefined, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

function toRow(r: Raw): ShortRow {
  return {
    id: Number(r.id),
    productName: String(r.product_name),
    productUrl: (r.product_url as string | null) ?? null,
    naverUrl: (r.naver_url as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    program: r.program as ShortRow["program"],
    facts: parseJson<string[]>(r.facts, []),
    scores: parseJson<Scores | null>(r.scores, null),
    status: r.status as ShortStatus,
    script: parseJson<unknown | null>(r.script, null),
    clips: parseJson<unknown[]>(r.clips, []),
    videoPath: (r.video_path as string | null) ?? null,
    remoteUrl: (r.remote_url as string | null) ?? null,
    minutes: Number(r.minutes ?? 0),
    aiCredits: Number(r.ai_credits ?? 0),
    hookType: (r.hook_type as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    keyword: (r.keyword as string | null) ?? null,
    postedAt: (r.posted_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  if (!columns(db, table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

const METRICS_DDL = `
  CREATE TABLE IF NOT EXISTS metrics (
    short_id INTEGER NOT NULL REFERENCES shorts(id),
    date TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'YOUTUBE',
    views INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0,
    commission INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'COUPANG_LINK',
    PRIMARY KEY (short_id, date, platform)
  );`;

export function openDb(file: string = dbPath()): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS shorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      product_url TEXT,
      category TEXT,
      program TEXT NOT NULL DEFAULT 'COUPANG',
      facts TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      script TEXT,
      clips TEXT NOT NULL DEFAULT '[]',
      video_path TEXT,
      remote_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS channel (
      date TEXT NOT NULL,
      platform TEXT NOT NULL,
      followers INTEGER NOT NULL DEFAULT 0,
      views_90d INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, platform)
    );
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'NEW',
    short_id INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  ensureColumn(db, "shorts", "naver_url", "TEXT");
  ensureColumn(db, "shorts", "scores", "TEXT");
  ensureColumn(db, "shorts", "minutes", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "shorts", "ai_credits", "INTEGER NOT NULL DEFAULT 0");
  for (const c of ["hook_type", "title", "keyword", "posted_at"]) ensureColumn(db, "shorts", c, "TEXT");

  // 초기 버전 metrics(플랫폼 구분 없음) → 플랫폼별 기록으로 옮김
  const hasMetrics = columns(db, "metrics").length > 0;
  if (hasMetrics && !columns(db, "metrics").includes("platform")) {
    db.exec(`ALTER TABLE metrics RENAME TO metrics_v1; ${METRICS_DDL}
      INSERT INTO metrics (short_id, date, platform, views, clicks, orders, commission)
        SELECT short_id, date, 'YOUTUBE', views, clicks, orders, commission FROM metrics_v1;
      DROP TABLE metrics_v1;`);
  } else db.exec(METRICS_DDL);
  return db;
}

export function createShort(
  db: DatabaseSync,
  input: { productName: string; productUrl?: string; naverUrl?: string; category?: string; program?: ShortRow["program"]; facts?: string[] },
): ShortRow {
  const res = db
    .prepare("INSERT INTO shorts (product_name, product_url, naver_url, category, program, facts) VALUES (?, ?, ?, ?, ?, ?)")
    .run(input.productName, input.productUrl ?? null, input.naverUrl ?? null, input.category ?? null, input.program ?? "COUPANG", JSON.stringify(input.facts ?? []));
  return getShort(db, Number(res.lastInsertRowid))!;
}

export function getShort(db: DatabaseSync, id: number): ShortRow | null {
  const r = db.prepare("SELECT * FROM shorts WHERE id = ?").get(id) as Raw | undefined;
  return r ? toRow(r) : null;
}

export function listShorts(db: DatabaseSync): ShortRow[] {
  return (db.prepare("SELECT * FROM shorts ORDER BY id DESC").all() as Raw[]).map(toRow);
}

export type ShortPatch = Partial<Pick<ShortRow, "status" | "script" | "clips" | "videoPath" | "remoteUrl" | "scores" | "minutes" | "aiCredits" | "hookType" | "title" | "keyword" | "postedAt" | "facts">>;

export function updateShort(db: DatabaseSync, id: number, patch: ShortPatch): ShortRow {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => (sets.push(`${col} = ?`), vals.push(v));
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.script !== undefined) set("script", JSON.stringify(patch.script));
  if (patch.clips !== undefined) set("clips", JSON.stringify(patch.clips));
  if (patch.scores !== undefined) set("scores", JSON.stringify(patch.scores));
  if (patch.videoPath !== undefined) set("video_path", patch.videoPath);
  if (patch.remoteUrl !== undefined) set("remote_url", patch.remoteUrl);
  if (patch.minutes !== undefined) set("minutes", patch.minutes);
  if (patch.aiCredits !== undefined) set("ai_credits", patch.aiCredits);
  if (patch.hookType !== undefined) set("hook_type", patch.hookType);
  if (patch.title !== undefined) set("title", patch.title);
  if (patch.keyword !== undefined) set("keyword", patch.keyword);
  if (patch.postedAt !== undefined) set("posted_at", patch.postedAt);
  if (patch.facts !== undefined) set("facts", JSON.stringify(patch.facts));
  if (sets.length) db.prepare(`UPDATE shorts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  const row = getShort(db, id);
  if (!row) throw new Error(`쇼츠 #${id} 를 찾을 수 없어요.`);
  return row;
}

/** 모든 쇼츠에서 이미 쓴 스톡 원본 URL — 채널 안 소스 중복을 피하는 데 씁니다. */
export function usedSourceUrls(db: DatabaseSync): Set<string> {
  const urls = new Set<string>();
  for (const s of listShorts(db)) for (const c of s.clips as { sourceUrl?: string }[]) if (c.sourceUrl) urls.add(c.sourceUrl);
  return urls;
}

export const PLATFORMS = ["INSTAGRAM", "YOUTUBE", "TIKTOK", "NAVER", "THREADS"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const SOURCES = ["COUPANG_LINK", "SHOPPING_CONNECT", "YT_SHOPPING", "VIEWS"] as const;
export type Source = (typeof SOURCES)[number];

export function toPlatform(v: string | undefined, fallback: Platform = "INSTAGRAM"): Platform {
  const u = (v ?? "").toUpperCase();
  if (!u) return fallback;
  if ((PLATFORMS as readonly string[]).includes(u)) return u as Platform;
  throw new Error(`플랫폼은 ${PLATFORMS.join(", ")} 중 하나예요.`);
}

export function toSource(v: string | undefined, platform: Platform): Source {
  const u = (v ?? "").toUpperCase();
  if ((SOURCES as readonly string[]).includes(u)) return u as Source;
  if (u) throw new Error(`수익원은 ${SOURCES.join(", ")} 중 하나예요.`);
  return platform === "NAVER" ? "SHOPPING_CONNECT" : "COUPANG_LINK";
}

/** 날짜별 누적값 기록(같은 날짜·플랫폼이면 덮어씀). 조회수는 각 앱 인사이트, 클릭·주문·수수료는 제휴 리포트에서 옮겨 적습니다. */
export function recordMetric(
  db: DatabaseSync,
  m: { shortId: number; date: string; platform?: Platform; source?: Source; views?: number; clicks?: number; orders?: number; commission?: number },
): void {
  const platform = m.platform ?? "YOUTUBE";
  db.prepare(
    `INSERT INTO metrics (short_id, date, platform, views, clicks, orders, commission, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(short_id, date, platform) DO UPDATE SET views = excluded.views, clicks = excluded.clicks, orders = excluded.orders, commission = excluded.commission, source = excluded.source`,
  ).run(m.shortId, m.date, platform, m.views ?? 0, m.clicks ?? 0, m.orders ?? 0, m.commission ?? 0, m.source ?? toSource(undefined, platform));
}

export function recordChannel(db: DatabaseSync, c: { date: string; platform: Platform; followers?: number; views90d?: number }): void {
  db.prepare(
    `INSERT INTO channel (date, platform, followers, views_90d) VALUES (?, ?, ?, ?)
     ON CONFLICT(date, platform) DO UPDATE SET followers = excluded.followers, views_90d = excluded.views_90d`,
  ).run(c.date, c.platform, c.followers ?? 0, c.views90d ?? 0);
}

export type ChannelRow = { date: string; platform: Platform; followers: number; views90d: number };

export function latestChannel(db: DatabaseSync): ChannelRow[] {
  return (
    db
      .prepare(
        `SELECT c.date, c.platform, c.followers, c.views_90d AS views90d FROM channel c
         WHERE c.date = (SELECT MAX(date) FROM channel WHERE platform = c.platform) ORDER BY c.platform`,
      )
      .all() as ChannelRow[]
  ).map((r) => ({ ...r, followers: Number(r.followers), views90d: Number(r.views90d) }));
}

export type ReportRow = {
  id: number;
  productName: string;
  status: string;
  minutes: number;
  aiCredits: number;
  hookType: string | null;
  keyword: string | null;
  postedAt: string | null; views: number; clicks: number; orders: number; commission: number; byPlatform: Partial<Record<Platform, number>> };

/** 쇼츠별 플랫폼 최신 기록을 합산 */
export function report(db: DatabaseSync): ReportRow[] {
  const shorts = db.prepare("SELECT id, product_name, status, minutes, ai_credits, hook_type, keyword, posted_at FROM shorts ORDER BY id").all() as Raw[];
  const latest = db
    .prepare(
      `SELECT m.* FROM metrics m
       WHERE m.date = (SELECT MAX(date) FROM metrics WHERE short_id = m.short_id AND platform = m.platform)`,
    )
    .all() as Raw[];
  return shorts.map((s) => {
    const rows = latest.filter((m) => Number(m.short_id) === Number(s.id));
    const sum = (k: string) => rows.reduce((a, m) => a + Number(m[k] ?? 0), 0);
    const byPlatform: Partial<Record<Platform, number>> = {};
    for (const m of rows) byPlatform[m.platform as Platform] = Number(m.views);
    return {
      id: Number(s.id),
      productName: String(s.product_name),
      status: String(s.status),
      minutes: Number(s.minutes ?? 0),
      aiCredits: Number(s.ai_credits ?? 0),
      hookType: (s.hook_type as string | null) ?? null,
      keyword: (s.keyword as string | null) ?? null,
      postedAt: (s.posted_at as string | null) ?? null,
      views: sum("views"),
      clicks: sum("clicks"),
      orders: sum("orders"),
      commission: sum("commission"),
      byPlatform,
    };
  });
}

export type Summary = {
  count: number;
  published: number;
  medianViews: number;
  ctr: number;
  commission: number;
  perShort: number;
  hours: number;
  perHour: number;
  /** AI 생성 비용(달러) */
  aiUsd: number;
};

/** Phase 0 판단용 요약: 편당 조회수 중앙값, 클릭률(클릭/조회), 누적 수수료, 시간당 수익 */
export function summarize(rows: ReportRow[]): Summary {
  const pub = rows.filter((r) => r.status === "PUBLISHED");
  const views = pub.map((r) => r.views).sort((a, b) => a - b);
  const mid = views.length ? (views.length % 2 ? views[(views.length - 1) / 2]! : (views[views.length / 2 - 1]! + views[views.length / 2]!) / 2) : 0;
  const totalViews = pub.reduce((a, r) => a + r.views, 0);
  const totalClicks = pub.reduce((a, r) => a + r.clicks, 0);
  const commission = rows.reduce((a, r) => a + r.commission, 0);
  const hours = rows.reduce((a, r) => a + r.minutes, 0) / 60;
  return {
    count: rows.length,
    published: pub.length,
    medianViews: mid,
    ctr: totalViews ? totalClicks / totalViews : 0,
    commission,
    perShort: pub.length ? Math.round(commission / pub.length) : 0,
    hours,
    perHour: hours ? Math.round(commission / hours) : 0,
    aiUsd: rows.reduce((a, r) => a + r.aiCredits, 0) * 0.01,
  };
}

/** 유튜브 수익창출 조건 진행률 — 기준 수치는 유튜브 고객센터에서 확인해 .env 에 넣습니다(바뀔 수 있어 코드에 고정하지 않음). */
export function yppProgress(ch: ChannelRow[], target: { subs?: number; shortsViews90d?: number }): { subs: number; views: number } | null {
  if (!target.subs && !target.shortsViews90d) return null;
  const yt = ch.find((c) => c.platform === "YOUTUBE");
  const ratio = (v: number, t?: number) => (t ? Math.min(1, v / t) : 1);
  return { subs: ratio(yt?.followers ?? 0, target.subs), views: ratio(yt?.views90d ?? 0, target.shortsViews90d) };
}

export const GROUP_BY = ["hook", "keyword", "hour"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
/** 그룹 비교에서 이보다 적은 편수는 우연일 가능성이 커서 "표본 부족"으로 표시 */
export const MIN_SAMPLE = 5;

export type GroupRow = { group: string; count: number; medianViews: number; commission: number; enough: boolean };

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
};

/** 공개된 쇼츠를 훅 유형·대표 키워드·올린 시간대로 묶어 조회수 중앙값 비교 */
export function groupReport(rows: ReportRow[], by: GroupBy): GroupRow[] {
  const key = (r: ReportRow): string => {
    if (by === "hook") return r.hookType ?? "(미기록)";
    if (by === "keyword") return r.keyword ?? "(미기록)";
    const h = r.postedAt?.match(/T(\d{2})/)?.[1];
    return h ? `${h}시` : "(미기록)";
  };
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows.filter((x) => x.status === "PUBLISHED")) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return [...groups.entries()]
    .map(([group, rs]) => ({
      group,
      count: rs.length,
      medianViews: median(rs.map((r) => r.views)),
      commission: rs.reduce((a, r) => a + r.commission, 0),
      enough: rs.length >= MIN_SAMPLE,
    }))
    .sort((a, b) => b.medianViews - a.medianViews);
}

// ─── 상품 후보 (discover) ───────────────────────────────────────────────
export type CandidateStatus = "NEW" | "PICKED" | "SKIPPED";
export type CandidateRow<T> = { id: number; key: string; data: T; score: number; status: CandidateStatus; shortId: number | null };

/** 같은 상품이 다시 발굴되면 데이터·점수는 새로, 상태(골랐음·건너뜀)는 유지 */
export function upsertCandidate<T>(db: DatabaseSync, key: string, data: T, score: number): void {
  db.prepare(
    `INSERT INTO candidates (key, data, score) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data, score = excluded.score, updated_at = datetime('now')`,
  ).run(key, JSON.stringify(data), score);
}

function toCandidate<T>(r: Raw): CandidateRow<T> {
  return { id: Number(r.id), key: String(r.key), data: JSON.parse(String(r.data)) as T, score: Number(r.score), status: r.status as CandidateStatus, shortId: r.short_id === null ? null : Number(r.short_id) };
}

export function listCandidates<T>(db: DatabaseSync, opts: { status?: CandidateStatus | "ALL"; limit?: number } = {}): CandidateRow<T>[] {
  const status = opts.status ?? "NEW";
  const rows = (status === "ALL"
    ? db.prepare("SELECT * FROM candidates ORDER BY score DESC LIMIT ?").all(opts.limit ?? 30)
    : db.prepare("SELECT * FROM candidates WHERE status = ? ORDER BY score DESC LIMIT ?").all(status, opts.limit ?? 30)) as Raw[];
  return rows.map((r) => toCandidate<T>(r));
}

export function getCandidate<T>(db: DatabaseSync, id: number): CandidateRow<T> | null {
  const r = db.prepare("SELECT * FROM candidates WHERE id = ?").get(id) as Raw | undefined;
  return r ? toCandidate<T>(r) : null;
}

export function setCandidateStatus(db: DatabaseSync, id: number, status: CandidateStatus, shortId?: number): void {
  db.prepare("UPDATE candidates SET status = ?, short_id = COALESCE(?, short_id), updated_at = datetime('now') WHERE id = ?").run(status, shortId ?? null, id);
}
