import { allHashtags, narration, type Script } from "./generate.js";

/**
 * 제목·태그·자막 점검 — 트래픽에 불리한 부분을 알려 줍니다(경고만, 차단하지 않음).
 * 근거: 제목은 모바일에서 뒤가 잘리고, 검색은 제목·캡션·태그·화면 글자·말한 단어를 봄.
 * 낚시 제목은 이탈이 늘고 유튜브 "오해의 소지가 있는 메타데이터" 정책에 걸릴 수 있음.
 */
export const TITLE_MAX = 40;
/** 키워드가 제목 앞쪽(이 글자 수 안)에 있어야 잘리지 않고 보임 */
export const KEYWORD_FRONT = 15;
export const ON_SCREEN_TITLE_MAX = 12;
export const CLICKBAIT = /(충격|경악|역대급|무조건|100\s?%|미쳤|미친|레전드|실화냐|난리\s?난)/;

const squash = (s: string) => s.replace(/\s+/g, "");

/** 키워드가 글 안에 있는지 — 띄어쓰기 무시, 또는 키워드의 모든 단어가 들어 있으면 포함으로 봄 */
export function containsKeyword(text: string, keyword: string): boolean {
  if (squash(text).includes(squash(keyword))) return true;
  const words = keyword.split(/\s+/).filter((w) => w.length >= 2);
  return words.length > 0 && words.every((w) => text.includes(w));
}

/** 제목에서 키워드가 시작하는 위치(띄어쓰기 무시), 없으면 -1 */
export function keywordPosition(title: string, keyword: string): number {
  return squash(title).indexOf(squash(keyword));
}

export function lintMetadata(script: Script): string[] {
  const out: string[] = [];
  const kw = script.searchKeywords;
  const main = kw[0];
  const title = script.titles[0] ?? "";

  if (!main) out.push("검색 키워드(searchKeywords)가 없어요 — 사람들이 칠 문제·상황 검색어를 넣으세요(예: \"서랍 정리\").");
  if (title.length > TITLE_MAX) out.push(`제목이 ${title.length}자예요 — ${TITLE_MAX}자 이내로 줄이세요(모바일에서 뒤가 잘림).`);
  if (main) {
    const pos = keywordPosition(title, main);
    if (pos < 0 && !containsKeyword(title, main)) out.push(`제목에 대표 키워드 "${main}"가 없어요.`);
    else if (pos > KEYWORD_FRONT) out.push(`제목에서 대표 키워드 "${main}"가 뒤쪽에 있어요 — 앞으로 옮기세요.`);

    const firstThree = narration(script).filter((l) => l.role === "HOOK" || l.role === "PROBLEM").slice(0, 2);
    if (!firstThree.some((l) => kw.some((k) => containsKeyword(l.text, k)))) {
      out.push(`첫 3초(훅·첫 공감 줄)에 검색 키워드를 말하지 않아요 — "${main}"를 자연스럽게 넣으세요(음성·자막이 검색에 쓰임).`);
    }
  }

  if (!script.onScreenTitle) out.push("첫 화면 제목 카드(onScreenTitle)가 없어요.");
  else if (script.onScreenTitle.length > ON_SCREEN_TITLE_MAX) out.push(`첫 화면 제목 카드가 ${script.onScreenTitle.length}자예요 — ${ON_SCREEN_TITLE_MAX}자 이내로.`);

  const tags = allHashtags(script);
  if (tags.length < 3) out.push(`해시태그가 ${tags.length}개예요 — 넓은 1 + 중간 2 + 구체 1~2 로 3~5개를 권장해요.`);
  if (tags.length > 5) out.push(`해시태그가 ${tags.length}개예요 — 플랫폼별로 앞 3~5개만 씁니다.`);

  for (const l of [...script.problem, ...script.solution]) {
    if (l.emphasis && !l.text.includes(l.emphasis)) out.push(`강조 단어 "${l.emphasis}"가 줄 "${l.text}"에 없어요.`);
  }

  const bait = [...script.titles, script.onScreenTitle ?? "", ...script.hooks].find((t) => CLICKBAIT.test(t));
  if (bait) out.push(`자극적인 낚시 표현이 있어요: "${bait}" — 이탈이 늘고 정책에 걸릴 수 있어요.`);
  return out;
}
