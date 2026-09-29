# 쇼핑쇼츠 스튜디오

**"요즘 뜨는 생활템·신상템"**(주방·생활·가전·디지털·반려·캠핑 등)을 **정보형으로 소개하는** 15~30초 쇼핑 쇼츠를 **합법 소스로만** 만드는 맥미니(Apple Silicon)용 CLI입니다. 쿠팡파트너스와 네이버 쇼핑커넥트를 씁니다.

```
discover(후보 발굴) → pick(초안) 또는 new(직접 입력) → score(선정 4기준) → script(훅 5개·공감·해결·CTA) → clip add(상품 이미지) → ai-clip(Runway)·stock(Pexels)
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
- **알아둘 위험**: 직접 촬영 없이 AI 영상, 스톡, AI 음성만 쓰는 채널은 유튜브의 "비진정성 콘텐츠" 판단에 걸리기 쉽습니다. 그래서 유튜브는 서브로만 쓰고, 편마다 컷 순서와 구간이 달라지게 렌더합니다. 본인 녹음(`render --voice`)을 섞으면 이 위험이 크게 줄어듭니다.

## 상품 발굴 (`discover` → `pick`)
어떤 상품을 만들지 매일 후보로 받아 봅니다. 공식 API와 공개 RSS만 쓰고, 페이지를 긁지 않습니다.
| 소스 | 무엇 | 키 |
|---|---|---|
| 쿠팡파트너스 Open API | 골드박스(오늘의 특가), 분야별 베스트, 검색. 파트너스 링크와 상품 이미지가 함께 옵니다 | `COUPANG_ACCESS_KEY/SECRET_KEY` |
| 구글 뉴스 RSS | 브랜드 신상품, 사전예약, 출시 예정 소식(제목·링크·날짜만) | 없음 |
| 네이버 데이터랩 | 후보 검색어의 최근 7일 검색 상승률 | `NAVER_CLIENT_ID/SECRET` (jk-biz와 같음) |

**점수** = 수요(베스트 순위) + 검색 상승률 + 가격대(1만~10만 원 가산, 10만~50만 원은 장바구니 효과로 가산) + 시의성(사전예약, 출시 D±7) + 신기함·문제 해결(Claude 1차 판정). 채널 분야 밖이면 감점합니다. 후보마다 점수 근거가 함께 표시됩니다.
```bash
npm run sss -- discover            # 후보 수집 + 점수 (--source coupang|launches, --no-judge)
npm run sss -- candidates          # 목록
npm run sss -- pick 12             # 쇼츠 초안 생성: 파트너스 링크·상품 이미지·확인된 사실(가격·사전예약·출시일)
npm run sss -- fact 3 "스테인리스 재질"   # 상품 페이지에서 확인한 사실 추가
npm run sss -- skip 13
```
- 뉴스 후보는 `pick`할 때 쿠팡에서 같은 상품을 검색해 고릅니다. 검색은 **1시간에 10회 제한**이 있습니다.
- **사전예약·신상 규칙**: 대사나 제목에 "사전예약" 또는 "출시 예정"을 넣고, 가격에는 "제작 시점 기준"을 붙입니다. 협찬받지 않았으면 "공식 추천·브랜드 협찬" 같은 표현을 쓰지 않습니다. 지키지 않으면 렌더가 막힙니다.
- 가전·디지털은 수수료율이 낮은 편입니다. 쿠팡파트너스의 카테고리별 수수료표를 확인하세요.
- 틱톡 크리에이티브센터와 인스타 인기 릴스는 공식 API가 없어 자동화하지 않았습니다. 트렌드 참고용으로 직접 둘러보세요.
- **매일 아침 자동 발굴(선택)**: `~/Library/LaunchAgents/com.sss.discover.plist`에 아래 예시를 넣고 `launchctl load`로 등록합니다(경로는 본인 것으로 바꾸세요).
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.sss.discover</string>
  <key>WorkingDirectory</key><string>/Users/me/shopping-shorts-studio</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/npm</string><string>run</string><string>sss</string><string>--</string><string>discover</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>7</integer></dict>
  <key>StandardOutPath</key><string>/tmp/sss-discover.log</string>
</dict></plist>
```

## 트래픽 올리는 제목·태그·설명·자막 (자동 적용 + `seo` 점검)
쇼츠 트래픽은 **추천 피드**와 **검색** 두 갈래로 들어옵니다. 추천 피드는 첫 2초의 멈춤, 끝까지 보기, 저장·공유로 정해집니다. 검색은 제목, 캡션, 태그, 화면 글자, 말한 단어를 봅니다. 쇼핑쇼츠는 제품명이 아니라 **문제로 검색된다**는 점이 핵심입니다("서랍 정리", "수저 정리").
| 항목 | 규칙(대본 생성과 `seo` 점검에 들어 있음) |
|---|---|
| 검색 키워드 | 사람들이 칠 문제·상황 검색어 3~5개. `keywords` 명령으로 네이버 월간 검색량을 보고 대표 키워드를 고릅니다 |
| 제목 | [키워드] + [결과·호기심], 40자 이내, 키워드는 앞 15자 안. 낚시어(충격·역대급·무조건 등)는 금지 |
| 첫 3초 | 훅이나 첫 공감 줄에서 키워드를 말합니다(음성·자막이 검색에 쓰임) |
| 첫 화면 | 0~1.5초에 12자 이내 **제목 카드**(키워드 헤드라인)를 띄웁니다 |
| 자막 | 한 줄, 화면 위쪽 1/3, 줄마다 핵심 단어 하나를 **노란색**으로 강조 |
| 해시태그 | 넓은 1 + 중간 2 + 구체 1~2. 유튜브는 제목 위에 보이는 3개를 검색성 높은 순으로, 인스타·틱톡은 3~5개 |
| 캡션 | 인스타·틱톡 첫 줄은 `[광고] 훅 \| 키워드`, 다음 줄에 대가 표기, 키워드 문장, 저장·공유와 댓글 키워드 CTA. 유튜브 설명은 대가 표기, 키워드 문장 순 |
| CTA | 인스타는 저장과 공유(DM 보내기)가 도달을 좌우합니다 → "저장하고, 필요한 사람에게 보내 주세요" |

**검증되지 않은 통설은 직접 비교합니다.** 올리는 시간, 훅 유형, 키워드처럼 확실하지 않은 것은 `posted --at 20:00`으로 올린 시각을 기록해 두고 `report --by hook|keyword|hour`로 비교하세요. 5편이 안 되는 그룹은 "표본 부족"으로 표시됩니다.

## 영상 소스와 역할
| 종류 `--kind` | 예 | 쓸 수 있는 역할 `--role` |
|---|---|---|
| `STOCK` | Pexels·Pixabay (`stock` 명령이 자동으로 받음) | HOOK, PROBLEM, CONTEXT |
| `AI` | AI로 만든 상황 이미지·영상(Runway 텍스트→영상 등) | HOOK, PROBLEM, CONTEXT |
| `AI_FROM_PRODUCT` | 실제 상품 이미지를 AI로 움직인 영상(`ai-clip`이 생성, 카메라 모션만) | **PRODUCT** 포함 전부 |
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

### AI 영상 (Runway, 유료) — 월 예산 3만 원
직접 촬영하지 않는 대신, 실제 상품 이미지를 **카메라 모션만** 주어 영상으로 만들고 문제 상황 장면은 텍스트로 생성합니다. AI 영상 도구는 **Runway 하나만** 씁니다(선택 이유는 아래).
- 키: [dev.runwayml.com](https://dev.runwayml.com)에서 결제를 설정하고 API 키를 받아 `.env`의 `RUNWAYML_API_SECRET`에 넣습니다. 개발자 크레딧은 1크레딧에 $0.01이고, 구독과 별개입니다. 첫 충전은 최소 **10달러(약 1만 4천 원)**입니다.
- 비용 예: gen4_turbo 이미지→영상 5초에 약 $0.25(약 350원), gen4.5 텍스트→영상 5초에 약 $0.60(약 840원). 기본 구성(상품 2개 + 문제 1개)은 쇼츠 1편에 **약 $1.1(약 1,500원)**입니다.
- **월 예산**: `.env`의 `SSS_MONTHLY_BUDGET_KRW`(기본 30,000원)와 `SSS_USD_KRW`(기본 1,400원)로 정합니다. Claude 구독료를 뺀 비용 기준입니다.
  - `ai-clip`은 이번 달에 쓴 돈에 예상 비용을 더해 **예산을 넘으면 생성하지 않습니다**. 80%를 넘으면 경고합니다.
  - 비용을 모르는 모델은 예산을 지킬 수 없어 생성을 막습니다.
  - `report`에 이번 달 AI 비용과 남은 예산이 나옵니다.
  - 월 3만 원이면 기본 구성으로 약 20편입니다. 더 아끼려면 `--no-problem`(문제 장면은 무료 스톡으로)이나 `--products 1`을 쓰세요. 편당 약 350~700원까지 줄어듭니다.
- `ai-clip`은 생성하기 전에 계획과 예상 비용(원화 포함)을 보여 주고 확인을 받습니다(`--dry-run`이면 계획만 봅니다).
- **지키는 선**
  - 상품 영상의 프롬프트는 회전, 푸시인, 오빗, 팬 같은 카메라 움직임만 허용합니다. "닦인다", "정리된다", "전후 비교", 손이나 사람이 쓰는 장면처럼 기능·효과를 연출하면 거부됩니다. 실제로 일어나지 않은 효과를 보여 주는 광고가 되기 때문입니다.
  - 사람이나 AI 아바타가 제품을 소개·추천·후기·언박싱하는 연출도 거부됩니다(가짜 후기).
  - 상황 장면은 특정 상품이 보이지 않게 생성합니다.
  - 생성된 상품 영상은 모양, 색, 크기가 원본과 같은지 `approve`에서 확인합니다.
  - AI 장면이 있으면 각 플랫폼의 AI 콘텐츠 표시를 켭니다.
  - 넣는 상품 이미지의 사용 권리는 제휴 프로그램 약관과 Runway 약관을 확인하세요.

**Runway를 고른 이유 (Higgsfield와 비교)**: Higgsfield는 설정이 쉽고 모델이 많습니다. 하지만 이 분량(월 수십 클립)에는 유료 구독이 월 $47~59 수준으로 예산을 넘고, 남은 크레딧도 이월되지 않습니다. 4K나 시네마틱 프리셋은 1080p 상품 모션 컷에는 효과가 작고, 아바타·UGC 기능은 가짜 후기 위험이 있습니다. Runway는 쓴 만큼만 내고, `ai-clip`으로 규칙 점검과 비용 기록까지 자동으로 됩니다.

### Runway MCP (Claude Code에서 대화로 생성, 선택)
```bash
npm run setup:runway-mcp            # 공식 runwayml/runway-api-mcp-server 를 vendor/ 에 받아 빌드
echo 'export RUNWAYML_API_SECRET=key_xxx' >> ~/.zshrc && source ~/.zshrc
claude                              # 이 폴더에서 실행 → .mcp.json 의 runway 서버 승인
```
대화로 프롬프트를 시험해 볼 때 씁니다. 평소 생산은 `ai-clip`으로 하세요.
- `npm run sss -- ai-brief 3`: 규칙과 컷별 프롬프트가 담긴 요청서가 나옵니다. Claude 대화창에 붙여 넣으세요.
- 대화로 만든 영상은 **반드시 `ai-import`로 등록**합니다. 그래야 규칙 점검, 출처 기록, 월 예산 합산이 됩니다.
```bash
npm run sss -- ai-import 3 ~/Downloads/rw-1.mp4 --role PRODUCT --from 1 \
  --prompt "Gentle camera orbit around the exact product shown, clean neutral background" --model gen4_turbo --usd 0.25
```

### 스톡 영상 (무료, 보조)
[Pexels API](https://www.pexels.com/api/) 키를 무료로 발급받아 `.env`의 `PEXELS_API_KEY`에 넣으세요. 이미 다른 쇼츠에 쓴 영상은 자동으로 건너뜁니다.

## 사용 예
```bash
npm run sss -- new "서랍 칸막이 정리함" --url "<쿠팡파트너스 링크>" --naver-url "<쇼핑커넥트 링크>" \
  --fact "길이 조절 가능" --fact "6칸"                 # 상품 페이지에서 확인한 사실만
npm run sss -- score 1                                   # 4기준 질문
npm run sss -- script 1                                  # data/shorts/1/script.json 에서 hookIndex 고르고 [경험 추가] 정리
npm run sss -- keywords 1                                # 네이버 검색량 → keywords 1 --pick "서랍 정리"
npm run sss -- seo 1                                     # 제목·태그·키워드·자막 점검
npm run sss -- clip add 1 ~/Downloads/상품.jpg --kind PRODUCT_IMAGE --role PRODUCT \
  --source "<상품 페이지 URL>" --proof "쿠팡파트너스 상품 이미지"
npm run sss -- ai-clip 1 --dry-run                       # 계획·예상 비용만
npm run sss -- ai-clip 1 --context                       # 상품 모션 2 + 문제 장면 + 분위기 장면 생성
npm run sss -- stock 1 "clean modern kitchen" --role CONTEXT   # (선택) 무료 스톡으로 보충
npm run sss -- clip check 1
npm run sss -- render 1 --speed 1.15
open data/shorts/1/short-1.mp4
npm run sss -- export 1        # data/exports/1/ → 에어드롭으로 아이폰에
npm run sss -- approve 1       # 올리기 전 체크리스트
# 폰에서 인스타·유튜브·틱톡·네이버 클립에 업로드 (각 앱의 광고 표시 켜기)
npm run sss -- posted 1 --at 20:00
npm run sss -- track 1 --platform INSTAGRAM --views 12000 --clicks 85 --commission 2400 --minutes 30
npm run sss -- track-channel --platform YOUTUBE --followers 320 --views90 850000
npm run sss -- report
npm run sss -- report --by hook     # 훅 유형별 조회수 중앙값 (keyword, hour 도 가능)
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
