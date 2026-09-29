import type { Script } from "../script/generate.js";
import { PRODUCT_MOTIONS, productPrompt, scenePrompt } from "./guard.js";

/**
 * Claude 대화창(Higgsfield MCP·Runway 호스팅 MCP 등)에 붙여 넣는 생성 요청서.
 * 대화로 만든 영상도 CLI 와 같은 규칙을 따르도록, 규칙과 장면별 프롬프트를 함께 줍니다.
 * 결과 영상은 반드시 `sss ai-import` 로 등록해 점검·출처·비용 기록을 남깁니다.
 */
export type BriefTarget = "higgsfield" | "runway";

export const BRIEF_RULES = [
  "세로 9:16, 5초, 영상 안에 글자·로고·워터마크 없음.",
  "[상품 컷] 첨부한 실제 상품 이미지를 그대로 쓰고 카메라만 움직일 것(회전·푸시인·오빗·팬). 모양·색·크기·부품을 바꾸지 말 것.",
  "[상품 컷] 상품이 무언가를 닦거나 정리하거나 효과를 내는 연출, 전후 비교, 손·사람이 쓰는 장면 금지.",
  "[모든 컷] 사람·AI 아바타·인플루언서가 제품을 소개·추천·후기·언박싱하는 연출 금지(UGC·마케팅 스튜디오·아바타 기능 쓰지 말 것).",
  "[상황 컷] 특정 제품이 보이지 않게, 불편한 상황이나 공간 분위기만.",
  "각 컷의 최종 프롬프트·모델·해상도·소모 크레딧(또는 비용)을 알려 주고, 결과 파일을 저장할 것.",
];

export function buildBrief(opts: {
  shortId: number;
  productName: string;
  script: Script;
  productImages: string[];
  target: BriefTarget;
  productShots?: number;
}): string {
  const n = opts.productShots ?? 2;
  const shots: string[] = [];
  for (let i = 0; i < n && opts.productImages.length; i++) {
    shots.push(`${shots.length + 1}. [상품 컷, 이미지→영상] 이미지: ${opts.productImages[i % opts.productImages.length]}\n   프롬프트: ${productPrompt(PRODUCT_MOTIONS[i % PRODUCT_MOTIONS.length]!)}`);
  }
  for (const l of opts.script.problem) shots.push(`${shots.length + 1}. [상황 컷, 텍스트→영상] 대사: "${l.text}"\n   프롬프트: ${scenePrompt(l.clipHint)}`);

  const tool = opts.target === "higgsfield" ? "Higgsfield(MCP)" : "Runway(MCP)";
  const modelHint =
    opts.target === "higgsfield"
      ? "상품 컷은 이미지→영상 모델 중 원본 보존이 좋은 것(예: Kling·Seedance 이미지→영상)과 카메라 프리셋을 쓰되, 인물·아바타가 나오는 프리셋은 쓰지 마세요. 1080p 이하면 충분합니다(4K 불필요)."
      : "상품 컷은 gen4_turbo, 상황 컷은 gen4.5 를 기본으로 쓰세요.";
  return [
    `${tool}로 쇼핑쇼츠 #${opts.shortId} "${opts.productName}"에 쓸 짧은 영상 클립을 만들어 주세요.`,
    "",
    "지켜야 할 규칙:",
    ...BRIEF_RULES.map((r) => `- ${r}`),
    `- ${modelHint}`,
    "",
    "만들 컷:",
    ...shots,
    "",
    "다 만든 뒤에는 컷마다 아래 형식으로 등록 명령을 알려 주세요(저는 터미널에서 실행합니다):",
    `npm run sss -- ai-import ${opts.shortId} <저장한 파일> --role PRODUCT|PROBLEM --prompt "<최종 프롬프트>" --provider ${opts.target} --model <모델> --usd <비용 달러> [--from <상품 이미지 clip 번호>]`,
  ].join("\n");
}
