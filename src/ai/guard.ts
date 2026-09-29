/**
 * AI 영상 프롬프트 가드 — 생성 도구(Runway·Higgsfield 등)와 상관없이 같은 규칙을 적용합니다.
 *
 * 1. 실제 상품 이미지로 만드는 영상은 "카메라 움직임"만 허용합니다.
 *    상품이 무언가를 닦고·지우고·정리하는 식의 기능·효과 연출은 실제로 일어나지 않은 일을 보여 주는 기만 광고가 됩니다.
 * 2. 어떤 장면이든 "사람(아바타)이 제품을 소개·추천·후기하는" 연출은 금지합니다 — 가짜 사용 후기(공정위 지침 위반).
 *    문제 상황 장면에 사람이 등장하는 것 자체는 괜찮습니다.
 */
export const PRODUCT_MOTIONS = [
  "Slow 360-degree turntable rotation of the exact product shown",
  "Slow cinematic camera push-in toward the exact product shown",
  "Gentle camera orbit around the exact product shown",
  "Subtle parallax camera pan across the exact product shown",
];
export const PRODUCT_SUFFIX =
  "clean neutral background, soft natural light. The product's shape, color, size and details stay exactly the same as the image. No hands, no people, no text, no logos, no added objects.";
export const SCENE_SUFFIX = "Vertical 9:16 realistic smartphone footage, natural light. No text, no logos, no brand names. Do not show any specific product.";

const MOTION_WORD = /(rotat|turntable|push-in|pull-back|dolly|orbit|pan\b|zoom|tilt|parallax|camera)/i;
const FORBIDDEN_ACTION =
  /\b(clean\w*|wip\w*|remov\w*|stain\w*|dirt\w*|grease|greasy|dust\w*|before|after|transform\w*|melt\w*|cut\w*|slic\w*|pour\w*|spray\w*|fill\w*|cook\w*|fix\w*|repair\w*|organi[sz]\w*|sort\w*|fold\w*|demonstrat\w*|using|uses?|hands?|person|people|results?|effect\w*|works?)\b/i;
/** 사람이 제품을 소개·추천·후기하는 연출 (Higgsfield 아바타·UGC·마케팅 스튜디오 류 포함) */
const PROMOTER =
  /\b(avatars?|influencers?|ugc|testimonials?|presenters?|spokes(?:person|people|woman|man)|talking\s+(?:to|into)\s+(?:the\s+)?camera|reviews?|reviewer|unboxing|recommend\w*|holding\s+(?:the|a|this)\s+product|hosts?\b)|아바타|인플루언서|후기|리뷰|언박싱|추천|들고/i;

/** 고정 안전 문구("No hands, no people…", "Do not show…")와 부정 표현은 연출이 아니므로 검사에서 뺍니다. */
function stripSafe(prompt: string): string {
  return (
    prompt
      .replace(PRODUCT_SUFFIX, "")
      .replace(SCENE_SUFFIX, "")
      .replace(/\bno\s+[\w-]+/gi, "")
      .replace(/\bdo not show[^.]*\.?/gi, "")
      // "clean neutral background" 처럼 배경·조명·화면을 묘사하는 말은 연출(닦기)이 아님
      .replace(/\bclean\s+(?:\w+\s+)?(?:background|backdrop|studio|surface|setting|look|lines|composition|lighting|white)\b/gi, "")
  );
}

function promoterProblem(core: string): string | null {
  const m = core.match(PROMOTER);
  return m ? `'${m[0]}' — 사람·아바타가 제품을 소개·추천·후기하는 연출은 가짜 후기가 돼서 쓸 수 없어요.` : null;
}

/** 실제 상품 이미지 기반 영상 프롬프트 점검 — 문제가 없으면 빈 배열 */
export function checkProductPrompt(prompt: string): string[] {
  const out: string[] = [];
  const core = stripSafe(prompt);
  if (!MOTION_WORD.test(core)) out.push("상품 영상 프롬프트에는 카메라 움직임(rotation, push-in, orbit, pan, zoom 등)만 적어 주세요.");
  const promo = promoterProblem(core);
  if (promo) out.push(promo);
  const bad = core.match(FORBIDDEN_ACTION);
  if (bad) out.push(`'${bad[0]}' — 상품의 기능·효과·사용 장면 연출은 쓸 수 없어요(실제로 일어나지 않은 효과를 보여 주는 광고가 됨).`);
  return out;
}

/** 문제·분위기·훅 장면 프롬프트 점검 — 사람 등장은 허용, 제품 소개·추천 연출은 금지 */
export function checkScenePrompt(prompt: string): string[] {
  const promo = promoterProblem(stripSafe(prompt));
  return promo ? [promo] : [];
}

export function productPrompt(motion: string): string {
  return `${motion}, ${PRODUCT_SUFFIX}`;
}

/** 문제 상황·분위기 장면 — 특정 상품이 보이지 않게 (가짜 상품 장면 방지) */
export function scenePrompt(hint: string): string {
  return `${hint.trim().replace(/\.$/, "")}. ${SCENE_SUFFIX}`;
}
