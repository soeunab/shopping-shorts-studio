import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createShort, latestChannel, openDb, recordChannel, recordMetric, report, summarize, toSource, updateShort, usedSourceUrls, yppProgress } from "../src/db.js";

describe("DB·성과", () => {
  it("플랫폼별 최신 기록 합산 → 요약·시간당 수익", () => {
    const db = openDb(":memory:");
    const a = createShort(db, { productName: "A", facts: ["실리콘 재질"], naverUrl: "https://naver.me/x" });
    const b = createShort(db, { productName: "B" });
    createShort(db, { productName: "C" });
    expect(a.naverUrl).toBe("https://naver.me/x");
    updateShort(db, a.id, { status: "PUBLISHED", minutes: 30 });
    updateShort(db, b.id, { status: "PUBLISHED", minutes: 30 });
    recordMetric(db, { shortId: a.id, date: "2026-10-01", platform: "INSTAGRAM", views: 100 });
    recordMetric(db, { shortId: a.id, date: "2026-10-05", platform: "INSTAGRAM", views: 1000, clicks: 10, orders: 2, commission: 900 });
    recordMetric(db, { shortId: a.id, date: "2026-10-05", platform: "YOUTUBE", views: 500 });
    recordMetric(db, { shortId: b.id, date: "2026-10-05", platform: "INSTAGRAM", views: 2500, clicks: 20, commission: 300 });

    const rows = report(db);
    const ra = rows.find((r) => r.id === a.id)!;
    expect(ra.views).toBe(1500);
    expect(ra.byPlatform).toEqual({ INSTAGRAM: 1000, YOUTUBE: 500 });
    const s = summarize(rows);
    expect(s).toMatchObject({ count: 3, published: 2, medianViews: 2000, commission: 1200, perShort: 600, hours: 1, perHour: 1200 });
    expect(s.ctr).toBeCloseTo(30 / 4000);
  });

  it("네이버는 기본 수익원이 쇼핑커넥트", () => {
    expect(toSource(undefined, "NAVER")).toBe("SHOPPING_CONNECT");
    expect(toSource(undefined, "INSTAGRAM")).toBe("COUPANG_LINK");
    expect(() => toSource("xx", "INSTAGRAM")).toThrow();
  });

  it("채널 기록과 수익창출 조건 진행률(기준은 설정값)", () => {
    const db = openDb(":memory:");
    recordChannel(db, { date: "2026-10-01", platform: "YOUTUBE", followers: 100, views90d: 100_000 });
    recordChannel(db, { date: "2026-10-08", platform: "YOUTUBE", followers: 250, views90d: 1_500_000 });
    const ch = latestChannel(db);
    expect(ch).toEqual([{ date: "2026-10-08", platform: "YOUTUBE", followers: 250, views90d: 1_500_000 }]);
    expect(yppProgress(ch, {})).toBeNull();
    expect(yppProgress(ch, { subs: 500, shortsViews90d: 3_000_000 })).toEqual({ subs: 0.5, views: 0.5 });
  });

  it("이미 쓴 스톡 URL 모음", () => {
    const db = openDb(":memory:");
    const a = createShort(db, { productName: "A" });
    updateShort(db, a.id, { clips: [{ file: "x", kind: "STOCK", role: "CONTEXT", sourceUrl: "https://www.pexels.com/video/1/" }] });
    expect(usedSourceUrls(db).has("https://www.pexels.com/video/1/")).toBe(true);
  });

  it("초기 버전 DB 를 자동으로 옮김(기존 기록 유지)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sss-db-"));
    const file = path.join(dir, "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE shorts (id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL, product_url TEXT, category TEXT,
        program TEXT NOT NULL DEFAULT 'COUPANG', facts TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'DRAFT', script TEXT,
        clips TEXT NOT NULL DEFAULT '[]', video_path TEXT, remote_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE metrics (short_id INTEGER NOT NULL, date TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
        orders INTEGER NOT NULL DEFAULT 0, commission INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (short_id, date));
      INSERT INTO shorts (product_name) VALUES ('옛 쇼츠');
      INSERT INTO metrics VALUES (1, '2026-09-30', 700, 3, 1, 450);`);
    old.close();
    const db = openDb(file);
    const r = report(db)[0]!;
    expect(r).toMatchObject({ productName: "옛 쇼츠", views: 700, commission: 450, minutes: 0, byPlatform: { YOUTUBE: 700 } });
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
