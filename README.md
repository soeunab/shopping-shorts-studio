# 쇼핑쇼츠 스튜디오

쿠팡파트너스·네이버 쇼핑커넥트용 15~30초 쇼핑 쇼츠를 **합법 소스로만** 만드는 맥미니(Apple Silicon)용 CLI입니다.

```
상품 등록 → 대본(Claude Code 구독) → 소스 등록·라이선스 점검 → 음성(say)·자막·ffmpeg 렌더
→ 유튜브 "비공개" 업로드 → 사람 검수(approve) → 공개(publish) → 성과 기록(track/report)
```

## 쓸 수 있는 영상 소스
| 종류 | 예 | 필요 정보 |
|---|---|---|
| `OWN` | 직접 산 제품을 아이폰으로 촬영 | — |
| `STOCK` | Pexels·Pixabay 무료 영상 | 원본 페이지 URL |
| `PERMISSION` | 판매자·제조사가 허락한 영상 | 허락 근거(`--proof`) |
| `AI` | AI로 만든 이미지·영상 | 업로드 시 '합성 콘텐츠'로 자동 표시 |
| `PRODUCT_IMAGE` | 제휴 프로그램이 홍보용으로 준 상품 이미지 | URL + 약관 근거 |

도우인·틱톡·유튜브·인스타 등 **다른 사람이 올린 영상은 등록 단계에서 거부**됩니다. 이런 영상을 쓰면 저작권 침해가 되고, 유튜브 재사용 콘텐츠 정책에 따라 채널이 제한될 수 있기 때문입니다.
가장 효과적인 방법은 **제품을 직접 사서 촬영하는 것**입니다. 차별화도 되고 대본에 쓸 "확인된 사실"도 생깁니다.

## 설치 (맥미니)
```bash
brew install node ffmpeg
npm install
cp .env.example .env
npm run doctor
```
- 한국어 음성 **Yuna**가 필요합니다. 추가 경로: 시스템 설정 → 손쉬운 사용 → 콘텐츠 읽어주기 → 시스템 음성 → 관리
- Claude Code에는 구독 계정으로 로그인하세요. 터미널에서 `claude` → `/login`

## 사용 예
```bash
npm run sss -- new "실리콘 사탕 아이스크림 틀" --category 주방 --url "<쿠팡파트너스 링크>" \
  --fact "실리콘 재질" --fact "6구" --fact "막대 포함"
npm run sss -- script 1          # data/shorts/1/script.json 확인·수정 ([경험 추가] 채우기)
npm run sss -- clip add 1 ~/Movies/틀-붓기.mov --kind OWN
npm run sss -- clip add 1 ~/Downloads/kids.mp4 --kind STOCK --source https://www.pexels.com/video/...
npm run sss -- render 1          # 첫 번째 소스가 훅 장면. --voice 녹음.m4a 로 내 목소리 사용 가능
open data/shorts/1/short-1.mp4   # 직접 확인
npm run sss -- upload 1          # 비공개
npm run sss -- approve 1         # 체크리스트 확인 후 승인
npm run sss -- publish 1
npm run sss -- track 1 --views 12000 --clicks 85 --orders 3 --commission 2400
npm run sss -- report
```

## 유튜브 연결
1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트를 만들고 **YouTube Data API v3**를 사용 설정합니다.
2. OAuth 동의 화면(외부, 테스트 사용자에 본인 추가)을 만든 뒤, **OAuth 클라이언트 ID → 데스크톱 앱**을 만들어 `.env`에 넣습니다.
3. `npm run sss -- youtube auth`를 실행하고 브라우저에서 채널 계정으로 로그인합니다.

알아둘 점:
- 검수(감사)를 받지 않은 API 프로젝트로 올린 영상은 유튜브가 비공개로 잠급니다. 그런 경우 `publish`가 실패하므로 유튜브 스튜디오에서 직접 공개하세요.
- 업로드 1건은 1,600 유닛을 씁니다. 기본 한도가 하루 10,000 유닛이라 하루 약 6건까지 올릴 수 있습니다.
- '유료 프로모션 포함' 표시는 API로 설정되지 않으므로 스튜디오에서 체크하세요. `approve` 체크리스트에도 들어 있습니다.

## 틱톡·인스타 릴스
렌더된 mp4를 각 앱에서 직접 올리세요. 각 플랫폼의 광고 표시 기능(브랜드 콘텐츠·유료 파트너십)을 켜야 합니다.

## Phase 0: 20편으로 먼저 검증
개발을 늘리기 전에 20편을 공개하고 `report`로 판단합니다.
- 조회수 중앙값, 클릭률(클릭÷조회), 편당 수수료를 봅니다.
- 쿠팡파트너스는 **최종 승인 조건(누적 판매 금액)**을 채워야 정산됩니다. 조건은 파트너스 페이지에서 확인하세요.
- 중단 기준을 미리 정해 두세요. 예: 20편 뒤 편당 수수료가 목표 이하이면 카테고리나 촬영 방식을 바꾸거나 중단합니다.
