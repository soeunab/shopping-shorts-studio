/**
 * 월 예산 — Claude 구독료를 뺀 나머지 비용(현재는 Runway AI 영상)의 한 달 상한.
 * 기본 3만 원. 예상 비용을 더해 넘으면 생성을 막고, 80%를 넘으면 경고합니다.
 */
export const DEFAULT_BUDGET_KRW = 30_000;
/** 환율은 대략값 — 실제 카드 청구 환율에 맞춰 .env 에서 바꾸세요. */
export const DEFAULT_USD_KRW = 1_400;
export const WARN_RATIO = 0.8;

const envNum = (v: string | undefined, fallback: number) => {
  const n = Number(v?.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function budgetKrw(env: NodeJS.ProcessEnv = process.env): number {
  return envNum(env.SSS_MONTHLY_BUDGET_KRW, DEFAULT_BUDGET_KRW);
}

export function usdKrw(env: NodeJS.ProcessEnv = process.env): number {
  return envNum(env.SSS_USD_KRW, DEFAULT_USD_KRW);
}

export const toKrw = (usd: number, rate = usdKrw()) => Math.round(usd * rate);

/** 이번 달 키 (로컬 시각 기준) */
export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type BudgetCheck = {
  ok: boolean;
  warn: boolean;
  spentKrw: number;
  addKrw: number;
  budgetKrw: number;
  remainingKrw: number;
  message: string;
};

/** 이번 달 쓴 돈(달러)에 이번 예상 비용(달러)을 더했을 때 예산 안인지 */
export function checkBudget(spentUsd: number, addUsd: number, budget = budgetKrw(), rate = usdKrw()): BudgetCheck {
  const spentKrw = toKrw(spentUsd, rate);
  const addKrw = toKrw(addUsd, rate);
  const after = spentKrw + addKrw;
  const remainingKrw = Math.max(0, budget - spentKrw);
  const ok = after <= budget;
  const warn = ok && after >= budget * WARN_RATIO;
  const won = (n: number) => `${n.toLocaleString()}원`;
  const message = !ok
    ? `이번 달 예산 초과예요: 쓴 돈 ${won(spentKrw)} + 이번 ${won(addKrw)} > 예산 ${won(budget)} (남은 예산 ${won(remainingKrw)}). 컷 수를 줄이거나(--products 1, --no-problem) 다음 달에 만드세요.`
    : `이번 달 AI 비용: ${won(spentKrw)} + 이번 ${won(addKrw)} = ${won(after)} / 예산 ${won(budget)}${warn ? " ⚠️ 80% 넘음" : ""}`;
  return { ok, warn, spentKrw, addKrw, budgetKrw: budget, remainingKrw, message };
}
