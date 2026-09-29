# 쇼핑쇼츠 스튜디오 — Claude Code 작업 안내

주방·살림 문제해결템을 **정보형**으로 소개하는 쇼핑쇼츠를 **합법 소스로만** 만드는 맥(Apple Silicon)용 CLI다. 흐름은 폰 업로드용 내보내기 → 사람 검수 → 업로드다.
TypeScript + `node:sqlite` + ffmpeg + 무료 AI 음성(Google Cloud TTS / macOS say). UI·문구·주석은 한국어로 쓴다.

## 구조
- `src/cli.ts`: 모든 명령 (`npm run sss -- <명령>`)
- `src/product/score.ts`: 제품 선정 4기준(신기함·문제 해결·시즌·카테고리)
- `src/sources/license.ts`: 소스 라이선스와 역할 점검. `BLOCKED_HOSTS`(도우인·틱톡·유튜브 등)를 거부하고, PRODUCT 역할은 `PRODUCT_KINDS`만 허용한다
- `src/sources/pexels.ts`: Pexels 스톡 검색과 다운로드(이미 쓴 영상 제외)
- `src/ai/runway.ts`: Runway API(공식 MCP 서버와 같은 API)
  - 상품 이미지는 카메라 모션 템플릿(`PRODUCT_MOTIONS`)으로, 상황 장면은 텍스트→영상으로 만든다
  - 기능·효과 연출은 `checkProductPrompt`가 차단한다
  - 생성 전에 비용 추정(`estimateCredits`)을 보여 준다
- `.mcp.json` + `scripts/setup-runway-mcp.sh`: 공식 Runway MCP(vendor/, 커밋하지 않음)
- `src/script/generate.ts`: 대본(훅 5개·공감·해결·CTA), 대가 표기, `[경험 추가]` 자리표시, 가짜 경험 탐지 `fakeExperienceLines`
- `src/script/seo.ts`: 제목·태그·키워드·자막 점검 `lintMetadata`(경고만, 차단 없음)
- `src/research/naver.ts`: 네이버 검색광고 API 월간 검색량(jk-biz `naverSearchAdKeywords` 이식)
- `src/media/`
  - `tts.ts`: 공급자 google/say, 외부 음성 무음 정렬
  - `googleTts.ts`
  - `subtitles.ts`: 한 줄 자막(위쪽 1/3), 첫 1.5초 제목 카드, 강조 단어 노란색
  - `render.ts`: 역할별 컷 계획, 시드 고정 무작위 구간
- `src/publish/`
  - `export.ts`: 플랫폼별 캡션과 links.txt
  - `youtube.ts`: 선택 기능. 비공개 업로드와 공개 전환
- `src/db.ts`: shorts·metrics(플랫폼별)·channel 테이블. 옛 스키마는 `openDb`가 자동으로 옮긴다

## 명령
```bash
npm test
npm run typecheck
npm run doctor
```

## 지켜야 할 것
- **다른 사람이 올린 영상(도우인·틱톡·샤오홍슈·유튜브·인스타 등)을 내려받거나 재편집하는 기능을 만들지 않는다.** `BLOCKED_HOSTS`를 줄이거나 `checkClips`를 우회하는 변경도 하지 않는다.
- **AI·스톡 소스를 실제 상품(PRODUCT) 장면에 쓰게 하지 않는다.** 예외는 `AI_FROM_PRODUCT` 하나다. 실제 상품 이미지에 카메라 모션만 준 영상이고, 원본·근거·프롬프트 기록이 필수다.
- **AI로 상품의 기능·효과(닦기·정리·전후 비교·사용 장면)를 연출하지 않는다.** `checkProductPrompt`의 금지어와 모션 필수 규칙을 약화시키지 않는다. 상황 장면 프롬프트의 "Do not show any specific product"도 유지한다.
- 유료 AI 호출(Runway)은 반드시 예상 비용을 보여 주고 확인을 받은 뒤 실행한다(`--yes`는 사용자가 명시할 때만). 쓴 크레딧은 기록한다.
- **가짜 사용 후기를 만들지 않는다.** `경험:` 사실이 없으면 1인칭 사용 경험을 막는 규칙(`SYSTEM` 프롬프트와 `fakeExperienceLines`)과 `[경험 추가]` 렌더 차단을 유지한다.
- **사람 검수 없이 공개되는 경로를 만들지 않는다.** `posted`와 `publish`는 `APPROVED` 상태에서만 동작하고, API 업로드는 항상 `privacyStatus: "private"`다.
- 대가 표기(모든 캡션 첫 부분과 화면 상단)를 빼지 않는다. 인스타·틱톡 첫 줄의 `[광고]`와 그다음 줄의 쿠팡 파트너스 문구를 유지한다.
- 트래픽 규칙에 낚시 제목, 관련 없는 인기 태그, 키워드 과다 삽입을 넣지 않는다(`CLICKBAIT` 점검 유지). 검증 안 된 통설은 규칙으로 박지 말고 `report --by`로 비교한다.
- AI 비용: 대본은 Claude 구독(`claude -p`)으로 만든다. API 키 경로를 추가하지 말고, `subscriptionEnv()`와 `--tools ""`를 약화시키지 않는다.
- 음성은 약관상 상업 이용이 가능한 공식 서비스만 쓴다. 비공식 엔드포인트는 쓰지 않는다.
- `data/`, `secrets/`, `.env`는 커밋하지 않는다.
