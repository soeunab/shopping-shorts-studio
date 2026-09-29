import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "./config.js";

/**
 * 상태 흐름: DRAFT → SCRIPTED → RENDERED → PRIVATE(비공개 업로드) → APPROVED(사람 검수) → PUBLISHED
 * 공개 전환은 APPROVED 이후에만 가능합니다.
 */
export type ShortStatus = "DRAFT" | "SCRIPTED" | "RENDERED" | "PRIVATE" | "APPROVED" | "PUBLISHED";

export type ShortRow = {
  id: number;
  productName: string;
  productUrl: string | null;
  category: string | null;
  program: "COUPANG" | "SHOPPING_CONNECT";
  facts: string[];
  status: ShortStatus;
  script: unknown | null;
  clips: unknown[];
  videoPath: string | null;
  remoteUrl: string | null;
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
    category: (r.category as string | null) ?? null,
    program: r.program as ShortRow["program"],
    facts: parseJson<string[]>(r.facts, []),
    status: r.status as ShortStatus,
    script: parseJson<unknown | null>(r.script, null),
    clips: parseJson<unknown[]>(r.clips, []),
    videoPath: (r.video_path as string | null) ?? null,
    remoteUrl: (r.remote_url as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

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
    CREATE TABLE IF NOT EXISTS metrics (
      short_id INTEGER NOT NULL REFERENCES shorts(id),
      date TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      commission INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (short_id, date)
    );
  `);
  return db;
}

/** 날짜별 누적값 기록(같은 날짜면 덮어씀). 조회수는 유튜브 스튜디오, 클릭·주문·수수료는 제휴 리포트에서 옮겨 적습니다. */
export function recordMetric(db: DatabaseSync, m: { shortId: number; date: string; views?: number; clicks?: number; orders?: number; commission?: number }): void {
  db.prepare(
    `INSERT INTO metrics (short_id, date, views, clicks, orders, commission) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(short_id, date) DO UPDATE SET views = excluded.views, clicks = excluded.clicks, orders = excluded.orders, commission = excluded.commission`,
  ).run(m.shortId, m.date, m.views ?? 0, m.clicks ?? 0, m.orders ?? 0, m.commission ?? 0);
}

export type ReportRow = { id: number; productName: string; category: string | null; status: string; views: number; clicks: number; orders: number; commission: number };

/** 쇼츠별 최신 기록 */
export function report(db: DatabaseSync): ReportRow[] {
  return (
    db
      .prepare(
        `SELECT s.id, s.product_name AS productName, s.category, s.status,
                COALESCE(m.views,0) AS views, COALESCE(m.clicks,0) AS clicks, COALESCE(m.orders,0) AS orders, COALESCE(m.commission,0) AS commission
         FROM shorts s
         LEFT JOIN metrics m ON m.short_id = s.id AND m.date = (SELECT MAX(date) FROM metrics WHERE short_id = s.id)
         ORDER BY s.id`,
      )
      .all() as ReportRow[]
  ).map((r) => ({ ...r, id: Number(r.id), views: Number(r.views), clicks: Number(r.clicks), orders: Number(r.orders), commission: Number(r.commission) }));
}

export type Summary = { count: number; published: number; medianViews: number; ctr: number; commission: number; perShort: number };

/** Phase 0 판단용 요약: 편당 조회수 중앙값, 클릭률(클릭/조회), 누적 수수료 */
export function summarize(rows: ReportRow[]): Summary {
  const pub = rows.filter((r) => r.status === "PUBLISHED");
  const views = pub.map((r) => r.views).sort((a, b) => a - b);
  const mid = views.length ? (views.length % 2 ? views[(views.length - 1) / 2]! : (views[views.length / 2 - 1]! + views[views.length / 2]!) / 2) : 0;
  const totalViews = pub.reduce((a, r) => a + r.views, 0);
  const totalClicks = pub.reduce((a, r) => a + r.clicks, 0);
  const commission = pub.reduce((a, r) => a + r.commission, 0);
  return {
    count: rows.length,
    published: pub.length,
    medianViews: mid,
    ctr: totalViews ? totalClicks / totalViews : 0,
    commission,
    perShort: pub.length ? Math.round(commission / pub.length) : 0,
  };
}

export function createShort(
  db: DatabaseSync,
  input: { productName: string; productUrl?: string; category?: string; program?: ShortRow["program"]; facts?: string[] },
): ShortRow {
  const res = db
    .prepare("INSERT INTO shorts (product_name, product_url, category, program, facts) VALUES (?, ?, ?, ?, ?)")
    .run(input.productName, input.productUrl ?? null, input.category ?? null, input.program ?? "COUPANG", JSON.stringify(input.facts ?? []));
  return getShort(db, Number(res.lastInsertRowid))!;
}

export function getShort(db: DatabaseSync, id: number): ShortRow | null {
  const r = db.prepare("SELECT * FROM shorts WHERE id = ?").get(id) as Raw | undefined;
  return r ? toRow(r) : null;
}

export function listShorts(db: DatabaseSync): ShortRow[] {
  return (db.prepare("SELECT * FROM shorts ORDER BY id DESC").all() as Raw[]).map(toRow);
}

export type ShortPatch = Partial<Pick<ShortRow, "status" | "script" | "clips" | "videoPath" | "remoteUrl">>;

export function updateShort(db: DatabaseSync, id: number, patch: ShortPatch): ShortRow {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (patch.status !== undefined) (sets.push("status = ?"), vals.push(patch.status));
  if (patch.script !== undefined) (sets.push("script = ?"), vals.push(JSON.stringify(patch.script)));
  if (patch.clips !== undefined) (sets.push("clips = ?"), vals.push(JSON.stringify(patch.clips)));
  if (patch.videoPath !== undefined) (sets.push("video_path = ?"), vals.push(patch.videoPath));
  if (patch.remoteUrl !== undefined) (sets.push("remote_url = ?"), vals.push(patch.remoteUrl));
  if (sets.length) db.prepare(`UPDATE shorts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  const row = getShort(db, id);
  if (!row) throw new Error(`쇼츠 #${id} 를 찾을 수 없어요.`);
  return row;
}
