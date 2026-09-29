import { describe, expect, it } from "vitest";
import { budgetKrw, checkBudget, DEFAULT_BUDGET_KRW, monthKey, toKrw, usdKrw } from "../src/budget.js";
import { monthSpendUsd, openDb, recordSpend } from "../src/db.js";

describe("월 예산 (Claude 구독료 제외)", () => {
  it("기본 3만 원, 환율 1,400원, .env 로 변경", () => {
    expect(budgetKrw({})).toBe(DEFAULT_BUDGET_KRW);
    expect(budgetKrw({ SSS_MONTHLY_BUDGET_KRW: "20,000" })).toBe(20000);
    expect(usdKrw({ SSS_USD_KRW: "1350" })).toBe(1350);
    expect(budgetKrw({ SSS_MONTHLY_BUDGET_KRW: "abc" })).toBe(DEFAULT_BUDGET_KRW);
    expect(toKrw(1.1, 1400)).toBe(1540);
  });

  it("예산 안이면 통과, 80% 넘으면 경고, 넘으면 차단", () => {
    expect(checkBudget(5, 1.1, 30000, 1400)).toMatchObject({ ok: true, warn: false, spentKrw: 7000, addKrw: 1540 });
    // 17달러(23,800원) + 1,540원 = 25,340원 ≥ 24,000원(80%)
    expect(checkBudget(17, 1.1, 30000, 1400)).toMatchObject({ ok: true, warn: true });
    // 16달러(22,400원) + 1,540원 = 23,940원 < 24,000원 → 경고 없음
    expect(checkBudget(16, 1.1, 30000, 1400)).toMatchObject({ ok: true, warn: false });
    const over = checkBudget(20.5, 1.1, 30000, 1400);
    expect(over.ok).toBe(false);
    expect(over.remainingKrw).toBe(1300);
    expect(over.message).toMatch(/예산 초과/);
  });

  it("월별 지출 합계, 0원은 기록하지 않음", () => {
    const db = openDb(":memory:");
    recordSpend(db, { month: "2026-10", shortId: 1, provider: "runway", usd: 0.25 });
    recordSpend(db, { month: "2026-10", provider: "runway", usd: 0.6 });
    recordSpend(db, { month: "2026-11", provider: "runway", usd: 1 });
    recordSpend(db, { month: "2026-10", provider: "runway", usd: 0 });
    expect(monthSpendUsd(db, "2026-10")).toBeCloseTo(0.85);
    expect(monthSpendUsd(db, "2026-12")).toBe(0);
  });

  it("이번 달 키", () => {
    expect(monthKey(new Date(2026, 0, 5))).toBe("2026-01");
  });
});
