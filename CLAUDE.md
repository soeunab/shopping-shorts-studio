# 쇼핑쇼츠 스튜디오 — Claude Code 작업 안내

쿠팡파트너스·네이버 쇼핑커넥트 쇼핑쇼츠를 **합법 소스로만** 만들어 유튜브에 비공개 업로드 → 사람 검수 → 공개하는 맥(Apple Silicon)용 CLI.
TypeScript + `node:sqlite` + ffmpeg + macOS `say`. UI·문구·주석은 한국어.

## 구조
- `src/cli.ts` — 모든 명령 (`npm run sss -- <명령>`)
- `src/sources/license.ts` — 소스 라이선스 점검. `BLOCKED_HOSTS`(도우인·틱톡·유튜브 등) 거부
- `src/script/generate.ts` — 대본 생성(Claude Code 구독), 대가 표기 문구, `[경험 추가]` 자리표시
- `src/media/` — `tts.ts`(say 합성·타이밍), `subtitles.ts`(ASS), `render.ts`(ffmpeg 인자), `exec.ts`
- `src/publish/youtube.ts` — OAuth(로컬 루프백), 비공개 업로드, 공개 전환
- `src/db.ts` — shorts·metrics 테이블, 성과 요약
- `data/`(DB·영상), `secrets/`(유튜브 토큰), `.env` 는 커밋하지 않습니다.

## 명령
```bash
npm test
npm run typecheck
npm run doctor
```

## 지켜야 할 것
- **다른 사람이 올린 영상(도우인·틱톡·유튜브·인스타 등)을 내려받거나 재편집하는 기능을 만들지 마세요.** `BLOCKED_HOSTS` 를 줄이거나 `checkClips` 를 우회하는 변경도 금지. 렌더·업로드 전 점검을 유지합니다.
- **사람 검수 없이 공개하는 경로를 만들지 마세요.** 업로드는 항상 `privacyStatus: "private"`, 공개는 `APPROVED` 상태에서만.
- 대본이 경험·수치·효능·가격을 지어내지 않도록 한 프롬프트 규칙과 `[경험 추가]` 렌더 차단을 유지하세요.
- 대가 표기(설명란 첫 줄 + 화면 상단)를 빼지 마세요.
- AI 비용: Claude 구독으로 운영합니다. API 키 경로를 추가하지 말고 `subscriptionEnv()`·`--tools ""` 를 약화시키지 마세요.
