# 쇼핑쇼츠 스튜디오

주방·살림 **문제해결템을 정보형으로 소개하는** 15~30초 쇼핑 쇼츠를 **합법 소스로만** 만드는 맥미니(Apple Silicon)용 CLI입니다. 쿠팡파트너스와 네이버 쇼핑커넥트를 씁니다.

```
new(제품) → score(선정 4기준) → script(훅 5개·공감·해결·CTA) → stock(Pexels 자동)·clip add(상품 이미지)
→ render(무료 AI 음성·한 줄 자막·2~3초 컷) → export(플랫폼별 캡션) → approve(사람 검수) → 폰으로 업로드 → posted → track/report
```

## 전략 요약 (레퍼런스 5개 교차 분석)
- **수익은 조회수가 아니라 제휴에서 나옵니다.** 유튜브 쇼핑 태그는 약 6.7~7%, 쿠팡 링크는 약 3%입니다. 다만 쇼핑 태그는 수익창출 조건을 채워야 쓸 수 있습니다. 그전에는 프로필이나 댓글 링크만 쓸 수 있는데, 사람들이 링크를 잘 누르지 않습니다(한 달 실측: 40시간에 2,892원). 그래서 **초기 목표는 수익이 아니라 팔로워와 수익창출 조건 달성**입니다.
- **제품 선정 4기준**: 신기한가, 문제를 해결하는가, 시즌·트렌드에 맞는가, 채널 카테고리와 맞는가. `score` 명령이 이 네 가지를 확인합니다.
- **편집 공식**: 처음 2초에 상품 → 공감 → 해결 → 저장 유도. 자막은 한 줄로, 컷은 2~3초마다 바꿉니다.
- **플랫폼**: 인스타 릴스가 메인입니다(팔로어 기반이라 안정적). 유튜브 쇼츠, 틱톡, 네이버 클립은 서브입니다.
- **하지 않는 것**
  - 도우인·틱톡·샤오홍슈 등 **다른 사람 영상 재편집**은 하지 않습니다. 저작권 문제가 있고, "같은 소스·같은 구조"는 수익창출 정지의 주된 사유입니다. 소스 등록 단계에서 거부됩니다.
  - **가짜 내돈내산**도 하지 않습니다. 써 보지 않았는데 "써 보니"라고 말하면 공정위 지침 위반입니다. 이런 문장이 있으면 렌더가 막힙니다.
  - **AI나 스톡 이미지를 실제 상품처럼 보여 주지 않습니다.** 상품 장면에는 실제 상품 이미지만 쓸 수 있습니다.
- **알아둘 위험**: 스톡, AI 이미지, AI 음성만 쓰는 채널은 유튜브의 "비진정성 콘텐츠" 판단에 걸리기 쉽습니다. 그래서 유튜브는 서브로만 쓰고, 편마다 컷 순서와 구간이 달라지게 렌더합니다. 나중에 직접 촬영(`--kind OWN`)이나 본인 녹음(`render --voice`)을 섞으면 이 위험이 크게 줄어듭니다.

## 영상 소스와 역할
| 종류 `--kind` | 예 | 쓸 수 있는 역할 `--role` |
|---|---|---|
| `STOCK` | Pexels·Pixabay (`stock` 명령이 자동으로 받음) | HOOK, PROBLEM, CONTEXT |
| `AI` | AI로 만든 상황 이미지·영상 | HOOK, PROBLEM, CONTEXT |
| `PRODUCT_IMAGE` | 쿠팡·네이버 상품 페이지 이미지(`--source` URL, `--proof` 근거 필수) | **PRODUCT** 포함 전부 |
| `PERMISSION` | 판매자가 사용을 허락한 영상(`--proof` 필수) | 전부 |
| `OWN` | 직접 촬영 | 전부 |

## 설치 (맥미니)
```bash
brew install node ffmpeg
npm install
cp .env.example .env     # 키 입력
npm run doctor
```

### 무료 음성 (`SSS_TTS`)
- **google (기본, 권장)**: Google Cloud Text-to-Speech. 공식 서비스이고, 생성한 음성을 상업적으로 쓸 수 있으며, 무료 한도 안에서는 무료입니다(쇼츠 1편에 약 300자). 설정 순서는 다음과 같습니다.
  1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 **Cloud Text-to-Speech API**를 사용 설정합니다.
  2. 사용자 인증 정보에서 **API 키**를 만듭니다. 키 제한은 Text-to-Speech API로 걸어 두세요.
  3. `.env`의 `GOOGLE_TTS_API_KEY`에 넣습니다. 음성은 `SSS_TTS_VOICE`로 바꿀 수 있습니다(기본 `ko-KR-Neural2-A`). 무료 한도는 가격 페이지에서 확인하세요.
- **say**: 맥 기본 음성으로 완전 무료이고 오프라인에서 동작합니다. 시스템 설정 → 손쉬운 사용 → 읽기 및 말하기 → 시스템 음성에서 **한국어 Yuna (프리미엄)**을 받아 두면 자동으로 그 음성을 씁니다.
- **파일**: 다른 도구로 만든 음성이나 본인 녹음을 `render --voice 파일`로 넣습니다. 앞뒤 무음을 자르고 속도를 맞추며, 숨 쉬는 구간에 맞춰 자막을 자동으로 넣습니다.
- 속도는 `render --speed 1.15`로 조절합니다(기본 1.1, 음높이는 유지).

### 스톡 영상
[Pexels API](https://www.pexels.com/api/) 키를 무료로 발급받아 `.env`의 `PEXELS_API_KEY`에 넣으세요. 이미 다른 쇼츠에 쓴 영상은 자동으로 건너뜁니다.

## 사용 예
```bash
npm run sss -- new "서랍 칸막이 정리함" --url "<쿠팡파트너스 링크>" --naver-url "<쇼핑커넥트 링크>" \
  --fact "길이 조절 가능" --fact "6칸"                 # 상품 페이지에서 확인한 사실만
npm run sss -- score 1                                   # 4기준 질문
npm run sss -- script 1                                  # data/shorts/1/script.json 에서 hookIndex 고르고 [경험 추가] 정리
npm run sss -- stock 1 "messy kitchen drawer" --role PROBLEM
npm run sss -- stock 1 "clean modern kitchen" --role CONTEXT --count 2
npm run sss -- clip add 1 ~/Downloads/상품.jpg --kind PRODUCT_IMAGE --role PRODUCT \
  --source "<상품 페이지 URL>" --proof "쿠팡파트너스 상품 이미지"
npm run sss -- clip check 1
npm run sss -- render 1 --speed 1.15
open data/shorts/1/short-1.mp4
npm run sss -- export 1        # data/exports/1/ → 에어드롭으로 아이폰에
npm run sss -- approve 1       # 올리기 전 체크리스트
# 폰에서 인스타·유튜브·틱톡·네이버 클립에 업로드 (각 앱의 광고 표시 켜기)
npm run sss -- posted 1
npm run sss -- track 1 --platform INSTAGRAM --views 12000 --clicks 85 --commission 2400 --minutes 30
npm run sss -- track-channel --platform YOUTUBE --followers 320 --views90 850000
npm run sss -- report
```
사람이 직접 써 본 경험이 있으면 `--fact "경험: 2주 사용, 서랍 3칸에 맞음"`처럼 `경험:`을 붙여 넣으세요. 그때만 1인칭 문장이 허용됩니다.

## 링크 연결 (중요)
- 유튜브 쇼츠의 설명·댓글 링크와 인스타 캡션 링크는 **눌리지 않습니다**. 링크는 **프로필 링크**에 걸어 두세요(`export`가 만드는 `links.txt` 참고).
- 인스타에서 "댓글에 키워드 → DM으로 링크" 자동 응답을 쓰려면 ManyChat 같은 **Meta 공식 파트너 도구**를 쓰세요. 무료 요금제가 있습니다. 댓글 키워드는 대본의 `commentKeyword`입니다.
- 네이버 클립에는 쇼핑커넥트 상품을 연결하세요.

## 올리는 시간
강의들은 오전 8시, 오후 6시, 저녁 8시를 추천하지만 검증된 수치는 아닙니다. `track`으로 기록하며 직접 비교하세요.

## 수익창출 조건 진행률
유튜브 파트너 프로그램과 쇼핑 제휴 조건은 바뀔 수 있어 코드에 고정하지 않았습니다. 유튜브 고객센터에서 확인한 값을 `.env`의 `SSS_YPP_SUBS`와 `SSS_YPP_SHORTS_VIEWS`에 넣으면 `report`가 진행률을 보여 줍니다.

## (선택) 유튜브 API 업로드
폰 업로드 대신 `youtube auth` → `upload`(비공개) → `approve` → `publish` 순서로 올릴 수도 있습니다. 검수받지 않은 API 프로젝트로 올린 영상은 유튜브가 비공개로 잠급니다. OAuth 설정은 `.env.example`을 참고하세요.

## 첫 6주 검증
30편을 올린 뒤 `report`로 판단합니다. 볼 지표는 조회수 중앙값, 팔로워와 구독자 증가, 수익창출 조건 진행률, 시간당 수익입니다. 반응이 약하면 카테고리 안에서 제품 유형을 바꾸거나 직접 촬영을 섞어 보세요.
