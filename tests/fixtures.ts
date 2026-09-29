import { PLACEHOLDER, ScriptSchema } from "../src/script/generate.js";

/** 테스트용 대본 (검색 키워드·제목 카드·강조·해시태그 구조 포함) */
export const sample = ScriptSchema.parse({
  hooks: ["서랍 열 때마다 한숨 나오죠", "서랍 정리 이거 하나로 끝", "아직도 칸막이 없이 쓰세요?"],
  hookTypes: ["문제", "반전", "질문"],
  hookIndex: 1,
  searchKeywords: ["서랍 정리", "수저 정리"],
  onScreenTitle: "서랍 정리 끝",
  problem: [{ text: "수저가 뒤섞여서 찾기 힘들고", clipHint: "messy kitchen drawer", emphasis: "수저" }],
  solution: [
    { text: "길이 조절 칸막이를 끼우면", clipHint: "drawer organizer", emphasis: "칸막이" },
    { text: `정리가 ${PLACEHOLDER}`, clipHint: "tidy drawer" },
  ],
  cta: "필요할 때 보게 저장해 두세요",
  commentKeyword: "칸막이",
  titles: ["서랍 정리 이거 하나면 끝"],
  hashtags: { broad: ["살림템"], mid: ["#주방정리", "# 서랍정리"], specific: ["#수저정리"] },
});

/** 첫 버전 형식의 script.json (해시태그 배열, 검색 키워드 없음) */
export const legacyRaw = {
  hooks: ["서랍 열 때마다 한숨 나오죠", "이거 하나로 서랍이 바뀌어요", "아직도 칸막이 없이 쓰세요?"],
  problem: [{ text: "수저가 뒤섞여서 찾기 힘들고", clipHint: "messy kitchen drawer" }],
  solution: [
    { text: "길이 조절 칸막이를 끼우면", clipHint: "drawer organizer" },
    { text: "서랍 크기에 맞춰 칸이 나뉘어요", clipHint: "tidy drawer" },
  ],
  cta: "필요할 때 보게 저장해 두세요",
  commentKeyword: "칸막이",
  titles: ["서랍 정리 끝판왕"],
  hashtags: ["#쇼츠", "#살림템", "#주방정리", "#서랍정리", "#수저정리"],
};
