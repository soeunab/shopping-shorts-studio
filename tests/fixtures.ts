import { PLACEHOLDER, ScriptSchema } from "../src/script/generate.js";

/** 테스트용 대본 */
export const sample = ScriptSchema.parse({
  hooks: ["서랍 열 때마다 한숨 나오죠", "이거 하나로 서랍이 바뀌어요", "아직도 칸막이 없이 쓰세요?"],
  hookIndex: 1,
  problem: [{ text: "수저가 뒤섞여서 찾기 힘들고", clipHint: "messy kitchen drawer" }],
  solution: [
    { text: "길이 조절 칸막이를 끼우면", clipHint: "drawer organizer" },
    { text: `정리가 ${PLACEHOLDER}`, clipHint: "tidy drawer" },
  ],
  cta: "필요할 때 보게 저장해 두세요",
  commentKeyword: "칸막이",
  titles: ["서랍 정리 끝판왕"],
  hashtags: ["#쇼츠", "#살림템"],
});
