import { describe, expect, it } from "vitest";
import { createShort, openDb, recordMetric, report, summarize, updateShort } from "../src/db.js";

describe("DB·성과", () => {
  it("등록 → 상태 변경 → 성과 요약", () => {
    const db = openDb(":memory:");
    const a = createShort(db, { productName: "A", facts: ["실리콘 재질"] });
    const b = createShort(db, { productName: "B" });
    createShort(db, { productName: "C" });
    expect(a.facts).toEqual(["실리콘 재질"]);
    updateShort(db, a.id, { status: "PUBLISHED" });
    updateShort(db, b.id, { status: "PUBLISHED" });
    recordMetric(db, { shortId: a.id, date: "2026-10-01", views: 100, clicks: 1 });
    recordMetric(db, { shortId: a.id, date: "2026-10-05", views: 1000, clicks: 10, orders: 2, commission: 900 });
    recordMetric(db, { shortId: b.id, date: "2026-10-05", views: 3000, clicks: 20, commission: 300 });

    const rows = report(db);
    expect(rows.find((r) => r.id === a.id)!.views).toBe(1000); // 최신 날짜 값
    const s = summarize(rows);
    expect(s).toMatchObject({ count: 3, published: 2, medianViews: 2000, commission: 1200, perShort: 600 });
    expect(s.ctr).toBeCloseTo(30 / 4000);
  });
});
