#!/usr/bin/env bash
# Runway 공식 MCP 서버(runwayml/runway-api-mcp-server)를 vendor/ 에 받아 빌드합니다.
# 이후 이 폴더에서 `claude` 를 실행하면 .mcp.json 의 runway 서버가 뜹니다(처음 한 번 승인).
# 키는 .env 가 아니라 셸 환경변수로 넣어야 Claude Code 가 읽습니다:
#   export RUNWAYML_API_SECRET=key_xxx   (~/.zshrc 에 추가 권장)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=vendor/runway-api-mcp-server
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  mkdir -p vendor
  git clone --depth 1 https://github.com/runwayml/runway-api-mcp-server "$DIR"
fi
(cd "$DIR" && npm install --silent && npm run build --silent)
echo "✅ Runway MCP 빌드 완료: $DIR/build/index.js"
if [ -z "${RUNWAYML_API_SECRET:-}" ]; then
  echo "⚠️ RUNWAYML_API_SECRET 환경변수가 없어요. ~/.zshrc 에 export RUNWAYML_API_SECRET=... 를 넣고 새 터미널에서 claude 를 실행하세요."
fi
