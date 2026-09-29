import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { shortDir } from "./config.js";
import {
  createShort,
  getShort,
  latestChannel,
  listShorts,
  openDb,
  PLATFORMS,
  recordChannel,
  recordMetric,
  report,
  summarize,
  toPlatform,
  toSource,
  updateShort,
  usedSourceUrls,
  yppProgress,
  groupReport,
  getCandidate,
  listCandidates,
  setCandidateStatus,
  upsertCandidate,
  GROUP_BY,
  MIN_SAMPLE,
  type GroupBy,
  type ShortRow,
} from "./db.js";
import { doctor } from "./doctor.js";
import { categoryMatches, channelCategory, evaluate, failedCriteria } from "./product/score.js";
import { probeDuration, runOk } from "./media/exec.js";
import { buildRenderArgs, isImage, planShots, type RoleSegment } from "./media/render.js";
import { buildAss } from "./media/subtitles.js";
import { prepareExternalVoice, providerFromEnv, synthesize } from "./media/tts.js";
import { exportDir, writeExport } from "./publish/export.js";
import { authorize, makePublic, uploadPrivate, videoIdOf } from "./publish/youtube.js";
import {
  COUPANG_DISCLOSURE,
  fakeExperienceLines,
  launchProblems,
  generateScript,
  narration,
  ON_SCREEN_DISCLOSURE,
  placeholdersIn,
  ScriptSchema,
  allHashtags,
  selectedHookType,
  type Script,
} from "./script/generate.js";
import { lintMetadata } from "./script/seo.js";
import { keywordVolumes, naverAdCred, rankKeywords } from "./research/naver.js";
import { AI_KINDS, checkClips, ClipSchema, ROLES, SOURCE_KINDS, type Clip, type Role, type SourceKind } from "./sources/license.js";
import { checkProductPrompt, estimateCredits, planAiJobs, productImageDataUri, RunwayClient, USD_PER_CREDIT } from "./ai/runway.js";
import { download as downloadFile } from "./sources/pexels.js";
import { COUPANG_CATEGORIES, CoupangClient, coupangCred, type CoupangProduct } from "./research/coupang.js";
import { naverOpenCred, trendMomentum } from "./research/datalab.js";
import { fetchLaunchNews, isPreorderTitle } from "./research/launches.js";
import { dedupe, enrich, extractLaunches, fromCoupang, fromLaunches, scoreCandidate, type Candidate, type LaunchInfo } from "./research/discover.js";
import { chooseVideos, download, searchPexels } from "./sources/pexels.js";

try {
  process.loadEnvFile(".env");
} catch {}

const HELP = `쇼핑쇼츠 스튜디오 (합법 소스 전용 · 정보형 쇼핑쇼츠)

준비
  doctor                                   환경 점검(ffmpeg·음성·Claude Code·API 키)
발굴
  discover [--source all|coupang|launches] [--limit 15] [--no-judge]
                                           쿠팡 골드박스·카테고리 베스트 + 신상·사전예약 뉴스 → 검색 상승률·가격대·신기함으로 점수
  candidates [--all]                       후보 목록 (점수 순)
  pick <후보번호>                          후보 → 쇼츠 초안(파트너스 링크·상품 이미지·확인된 사실 자동)
  fact <id> "사실"                         상품 페이지에서 확인한 사실 추가
  skip <후보번호>                          후보 건너뛰기
제작
  new "<제품명>" [--url 쿠팡링크] [--naver-url 쇼핑커넥트링크] [--category 주방] [--fact "..."]...
  score <id> [--novel] [--solves "해결하는 문제"] [--season] [--category C]   제품 선정 4기준 (옵션 없으면 질문)
  script <id>                              대본 생성 → data/shorts/<id>/script.json (훅 고르기: hookIndex)
  keywords <id> [--pick "검색어"]          네이버 월간 검색량으로 대표 검색 키워드 고르기 (검색광고 API 키 필요)
  seo <id>                                 제목·태그·키워드·자막 점검
  stock <id> "<영어 검색어>" [--role PROBLEM|CONTEXT|HOOK] [--count 3]     Pexels 무료 스톡 자동 받기
  ai-clip <id> [--products 2] [--no-problem] [--context] [--motion "camera ..."] [--dry-run] [--yes]
                                           Runway 로 AI 장면 생성: 실제 상품 이미지→카메라 모션, 공감 줄→상황 영상 (생성 전 비용 확인)
  clip add <id> <파일> --kind ${Object.keys(SOURCE_KINDS).join("|")} --role ${Object.keys(ROLES).join("|")} [--source URL] [--proof 근거]
  clip check <id>                          소스 라이선스·역할 점검
  render <id> [--speed 1.15] [--voice 음성파일] [--sw]   음성·한 줄 자막·2~3초 컷으로 1080x1920 mp4
올리기
  export <id>                              폰 업로드용 mp4 + 플랫폼별 캡션(instagram/youtube/tiktok/naver) + links.txt
  approve <id>                             올리기 전 사람 검수 체크리스트
  posted <id> [--at "2026-10-01T20:00"]   폰으로 올린 뒤 '공개됨' 기록(올린 시각 → 시간대별 비교)
  youtube auth | upload <id> | publish <id>   (선택) 유튜브 API 비공개 업로드 → 승인 후 공개
기록
  track <id> --platform ${PLATFORMS.join("|")} [--views N] [--clicks N] [--orders N] [--commission 원] [--source S] [--minutes 제작분]
  track-channel --platform YOUTUBE|INSTAGRAM|... [--followers N] [--views90 N]
  report [--by hook|keyword|hour]          성과·시간당 수익·AI 비용·수익창출 조건 진행률 / 훅 유형·키워드·시간대별 비교`;

function need(id: string | undefined): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error("쇼츠 번호(id)를 주세요.");
  return n;
}

function loadShort(db: ReturnType<typeof openDb>, id: number): ShortRow {
  const s = getShort(db, id);
  if (!s) throw new Error(`쇼츠 #${id} 가 없어요.`);
  return s;
}

/** 사람이 고친 script.json 이 있으면 그것을 우선 */
function currentScript(s: ShortRow): Script {
  const file = path.join(shortDir(s.id), "script.json");
  if (existsSync(file)) return ScriptSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (s.script) return ScriptSchema.parse(s.script);
  throw new Error(`대본이 없어요. 먼저: npm run sss -- script ${s.id}`);
}

/** 렌더·내보내기 전에 막아야 할 대본 문제 */
function scriptProblems(s: ShortRow, script: Script): string[] {
  const out: string[] = [];
  const ph = placeholdersIn(script);
  if (ph.length) out.push(`[경험 추가] 가 남아 있어요:\n  ${ph.join("\n  ")}`);
  const fake = fakeExperienceLines(script, s.facts);
  if (fake.length) out.push(`직접 써 보지 않았는데 사용 경험처럼 말하는 문장이 있어요(가짜 후기 금지):\n  ${fake.join("\n  ")}`);
  out.push(...launchProblems(script, s.facts));
  return out;
}

async function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return (await rl.question(q)).trim();
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await ask(rl, `${question} (y/N) `)).toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

/** 성과 비교용으로 쇼츠에 남기는 대본 정보 */
function metaOf(script: Script) {
  return { hookType: selectedHookType(script), title: script.titles[0] ?? null, keyword: script.searchKeywords[0] ?? null };
}

/** "2026-10-01T20:00" 또는 "20:00"(오늘) → 로컬 시각 ISO 문자열(시간대 비교용) */
function postedAt(at?: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!at) return local;
  if (/^\d{1,2}:\d{2}$/.test(at)) return `${local.slice(0, 10)}T${at.padStart(5, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) return at.slice(0, 16);
  throw new Error('--at 은 "2026-10-01T20:00" 또는 "20:00" 형식이에요.');
}

/** 후보 표 */
function printCandidates(rows: { id: number; score: number; status: string; data: Candidate }[]): void {
  console.log("번호  점수  출처     가격        상품 · 근거");
  for (const r of rows) {
    const c = r.data;
    const src = { GOLDBOX: "골드박스", BEST: "베스트", LAUNCH: c.isPreorder ? "사전예약" : "신상" }[c.source];
    const price = c.price ? `${c.price.toLocaleString()}원` : "-";
    console.log(`#${String(r.id).padEnd(4)}${r.score.toFixed(1).padStart(5)}  ${src.padEnd(6)} ${price.padStart(10)}  ${c.name.slice(0, 40)}${r.status !== "NEW" ? ` [${r.status}]` : ""}`);
    if (c.reasons.length) console.log(`${" ".repeat(30)}└ ${c.reasons.join(" · ")}`);
  }
}

const num = (v?: string) => (v === undefined ? undefined : Number(v.replaceAll(",", "")));
const today = () => new Date().toISOString().slice(0, 10);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const db = openDb();

  switch (cmd) {
    case "doctor": {
      const checks = await doctor();
      for (const c of checks) console.log(`${c.ok ? "✅" : c.optional ? "➖" : "❌"} ${c.name} — ${c.detail}${!c.ok && c.fix ? `\n   → ${c.fix}` : ""}`);
      return;
    }
    case "discover": {
      const { values } = parseArgs({ args: rest, options: { source: { type: "string" }, limit: { type: "string" }, "no-judge": { type: "boolean" } } });
      const source = values.source ?? "all";
      const limit = Number(values.limit ?? 15);
      let cands: Candidate[] = [];
      const cc = coupangCred();
      if (source === "all" || source === "coupang") {
        if (!cc) console.log("➖ 쿠팡파트너스 API 키 없음(COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY) — 건너뜀");
        else {
          const client = new CoupangClient(cc);
          try {
            cands.push(...fromCoupang(await client.goldbox(), "GOLDBOX"));
          } catch (e) {
            console.log(`⚠️ 골드박스: ${(e as Error).message}`);
          }
          for (const [id, name] of Object.entries(COUPANG_CATEGORIES)) {
            if (!categoryMatches(name)) continue;
            try {
              cands.push(...fromCoupang(await client.bestCategory(Number(id), 20), "BEST"));
            } catch (e) {
              console.log(`⚠️ ${name} 베스트: ${(e as Error).message}`);
            }
          }
          console.log(`쿠팡: ${cands.length}개`);
        }
      }
      if (source === "all" || source === "launches") {
        const news = await fetchLaunchNews();
        let infos: LaunchInfo[] = [];
        try {
          infos = news.length ? await extractLaunches(news, channelCategory()) : [];
        } catch (e) {
          // Claude 를 못 쓰면 제목에 '사전예약'이 있는 것만 후보로(분야는 사람이 확인)
          console.log(`⚠️ 뉴스 정리(Claude) 실패: ${(e as Error).message} — 사전예약 제목만 사용`);
          infos = news.map((n, index) => ({ index, relevant: isPreorderTitle(n.title), brand: null, product: n.title, category: null, isPreorder: true, launchDate: null }));
        }
        const launches = fromLaunches(news, infos);
        console.log(`신상·사전예약 뉴스: ${news.length}건 → 후보 ${launches.length}개`);
        cands.push(...launches);
      }
      cands = dedupe(cands).map((c) => scoreCandidate(c));
      let top = cands.filter((c) => c.score > -1).sort((a, b) => b.score - a.score).slice(0, limit * 2);
      if (!values["no-judge"] && top.length) {
        try {
          console.log("신기함·문제 해결 1차 판정 중(Claude 구독)…");
          top = await enrich(top);
        } catch (e) {
          console.log(`⚠️ 1차 판정 건너뜀: ${(e as Error).message}`);
        }
      }
      const nc = naverOpenCred();
      if (nc && top.some((c) => c.keyword)) {
        const m = await trendMomentum(top.map((c) => c.keyword!).filter(Boolean), nc);
        top = top.map((c) => (c.keyword && m[c.keyword] ? { ...c, momentum: m[c.keyword]! } : c));
      } else if (!nc) console.log("➖ 네이버 데이터랩 키 없음(NAVER_CLIENT_ID / NAVER_CLIENT_SECRET) — 검색 상승률 없이 점수");
      const final = top.map((c) => scoreCandidate(c)).sort((a, b) => b.score - a.score);
      for (const c of final) upsertCandidate(db, c.key, c, c.score);
      if (!final.length) return console.log("후보가 없어요. 키 설정(doctor)과 채널 분야(SSS_ALLOWED)를 확인하세요.");
      printCandidates(listCandidates<Candidate>(db, { limit }));
      console.log(`\n고르기: npm run sss -- pick <번호>   건너뛰기: npm run sss -- skip <번호>`);
      return;
    }
    case "candidates": {
      const { values } = parseArgs({ args: rest, options: { all: { type: "boolean" }, limit: { type: "string" } } });
      const rows = listCandidates<Candidate>(db, { status: values.all ? "ALL" : "NEW", limit: Number(values.limit ?? 30) });
      if (!rows.length) return console.log("후보가 없어요: npm run sss -- discover");
      printCandidates(rows);
      return;
    }
    case "fact": {
      const s = loadShort(db, need(rest[0]));
      const fact = rest.slice(1).join(" ").trim();
      if (!fact) throw new Error('사실을 주세요: fact 1 "스테인리스 재질"  (직접 써 본 경험이면 "경험: ..." 으로)');
      updateShort(db, s.id, { facts: [...s.facts, fact] });
      console.log(`✅ #${s.id} 사실 ${s.facts.length + 1}개: ${[...s.facts, fact].join(" / ")}`);
      return;
    }
    case "skip": {
      const id = need(rest[0]);
      if (!getCandidate(db, id)) throw new Error(`후보 #${id} 가 없어요.`);
      setCandidateStatus(db, id, "SKIPPED");
      console.log(`✅ 후보 #${id} 건너뜀`);
      return;
    }
    case "pick": {
      const cid = need(rest[0]);
      const row = getCandidate<Candidate>(db, cid);
      if (!row) throw new Error(`후보 #${cid} 가 없어요.`);
      if (row.status === "PICKED") throw new Error(`이미 고른 후보예요 → 쇼츠 #${row.shortId}`);
      let c = row.data;
      if (!c.partnerUrl) {
        // 뉴스 후보: 쿠팡에서 찾아 파트너스 링크·이미지 확보 (검색은 1시간 10회 제한)
        const cc = coupangCred();
        if (!cc) throw new Error("쿠팡파트너스 API 키가 있어야 뉴스 후보의 쿠팡 상품을 찾을 수 있어요. 아니면 쿠팡에서 직접 찾아 new --url 로 등록하세요.");
        const q = c.name;
        console.log(`쿠팡에서 "${q}" 검색 중(1시간 10회 제한)…`);
        const found = await new CoupangClient(cc).search(q, 5);
        if (!found.length) throw new Error("쿠팡에서 찾지 못했어요. 아직 판매 전이면 판매가 열린 뒤 다시 pick 하세요.");
        found.forEach((p, i) => console.log(`  [${i + 1}] ${p.productName} · ${p.productPrice.toLocaleString()}원`));
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const n = Number(await ask(rl, "같은 상품 번호(없으면 0) > "));
        rl.close();
        const p: CoupangProduct | undefined = found[n - 1];
        if (!p) return console.log("고르지 않았어요.");
        c = { ...c, name: p.productName, partnerUrl: p.productUrl, image: p.productImage, price: p.productPrice, isRocket: p.isRocket, category: c.category ?? p.categoryName ?? null };
      }
      const date = today();
      const facts = [
        c.price ? `가격 ${c.price.toLocaleString()}원 (${date} 기준, 변동 가능)` : null,
        c.brand ? `브랜드: ${c.brand}` : null,
        c.isPreorder ? "사전예약 상품" : null,
        c.launchDate ? `출시·출고 예정일: ${c.launchDate}` : null,
        c.isRocket ? "로켓배송 상품" : null,
      ].filter((x): x is string => !!x);
      const s = createShort(db, { productName: c.name, productUrl: c.partnerUrl ?? undefined, category: c.category ?? undefined, facts });
      if (c.image) {
        const dir = path.join(shortDir(s.id), "clips");
        mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `1-product${path.extname(new URL(c.image).pathname) || ".jpg"}`);
        await downloadFile(c.image, dest);
        const clip = ClipSchema.parse({ file: dest, kind: "PRODUCT_IMAGE", role: "PRODUCT", sourceUrl: c.partnerUrl ?? c.image, proof: `쿠팡파트너스 Open API 제공 상품 이미지 (${c.key})` });
        updateShort(db, s.id, { clips: [clip] });
      }
      // 1차 판정을 임시 점수로 — 사람이 score 로 확정
      updateShort(db, s.id, {
        scores: evaluate({ novel: c.novelty === 2, solves: c.solves, season: (c.momentum ?? 1) > 1.1 || c.isPreorder || !!c.launchDate, categoryMatch: categoryMatches(c.category) }),
      });
      setCandidateStatus(db, cid, "PICKED", s.id);
      console.log(`✅ 쇼츠 #${s.id} ${c.name}
   링크: ${c.partnerUrl ?? "-"}
   사실: ${facts.join(" / ") || "-"}
   상품 페이지에서 확인한 사실 더 넣기: npm run sss -- fact ${s.id} "스테인리스 재질"
   다음: npm run sss -- score ${s.id} (1차 판정 확인) → script ${s.id} → ai-clip ${s.id}`);
      return;
    }
    case "new": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { url: { type: "string" }, "naver-url": { type: "string" }, category: { type: "string" }, program: { type: "string" }, fact: { type: "string", multiple: true } },
      });
      const name = positionals.join(" ").trim();
      if (!name) throw new Error('제품명을 주세요: new "실리콘 아이스크림 틀"');
      const program = values.program === "SHOPPING_CONNECT" ? "SHOPPING_CONNECT" : "COUPANG";
      const s = createShort(db, {
        productName: name,
        productUrl: values.url,
        naverUrl: values["naver-url"],
        category: values.category,
        program,
        facts: values.fact ?? [],
      });
      console.log(`✅ #${s.id} ${s.productName} 등록. 다음: npm run sss -- score ${s.id}`);
      return;
    }
    case "list": {
      for (const s of listShorts(db)) console.log(`#${s.id}\t${s.status}\t${s.scores ? `${s.scores.passed}/4` : "-/4"}\t${s.productName}${s.remoteUrl ? `\t${s.remoteUrl}` : ""}`);
      return;
    }
    case "show": {
      console.log(JSON.stringify(loadShort(db, need(rest[0])), null, 2));
      return;
    }
    case "score": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { novel: { type: "boolean" }, solves: { type: "string" }, season: { type: "boolean" }, category: { type: "string" } },
      });
      const s = loadShort(db, need(positionals[0]));
      const interactive = values.novel === undefined && values.solves === undefined && values.season === undefined;
      let input: Parameters<typeof evaluate>[0];
      if (interactive) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const yes = async (q: string) => /^y/i.test(await ask(rl, `${q} (y/N) `));
        console.log(`제품: ${s.productName} · 채널 카테고리: ${channelCategory()}`);
        const novel = await yes("1. 신기한가요? (다이소·마트·로켓배송에서 흔히 보이지 않는 제품)");
        const solves = await ask(rl, "2. 어떤 불편을 해결하나요? 한 줄로 (모르면 엔터) > ");
        const season = await yes("3. 지금 시즌·트렌드에 맞나요?");
        rl.close();
        input = { novel, solves, season, categoryMatch: categoryMatches(s.category) };
      } else {
        input = { novel: !!values.novel, solves: values.solves, season: !!values.season, categoryMatch: categoryMatches(values.category ?? s.category) };
      }
      const scores = evaluate(input);
      updateShort(db, s.id, { scores });
      const failed = failedCriteria(scores);
      console.log(`${scores.passed === 4 ? "✅" : "⚠️"} ${scores.passed}/4 통과${failed.length ? ` — 미달: ${failed.join(", ")}` : ""}`);
      if (scores.passed < 2) console.log("   이 제품은 콘텐츠로서 힘이 약할 가능성이 높아요. 다른 제품을 고르는 걸 권해요.");
      return;
    }
    case "script": {
      const s = loadShort(db, need(rest[0]));
      if (!s.scores) console.log(`⚠️ 제품 선정 점검을 안 했어요: npm run sss -- score ${s.id}`);
      else if (s.scores.passed < 4) console.log(`⚠️ 제품 선정 ${s.scores.passed}/4 — 미달: ${failedCriteria(s.scores).join(", ")}`);
      console.log("대본 생성 중(Claude Code 구독)…");
      const script = await generateScript(s, s.scores?.solves);
      mkdirSync(shortDir(s.id), { recursive: true });
      const file = path.join(shortDir(s.id), "script.json");
      writeFileSync(file, JSON.stringify(script, null, 2));
      updateShort(db, s.id, { script, status: "SCRIPTED" });
      console.log("훅 후보 (script.json 의 hookIndex 로 선택, 기본 0):");
      script.hooks.forEach((h, i) => console.log(`  [${i}] ${h}`));
      console.log("대본:");
      narration(script).forEach((l) => console.log(`  ${l.role.padEnd(8)} ${l.text}`));
      console.log(`제목 후보: ${script.titles.join(" / ")}`);
      console.log(`검색 키워드: ${script.searchKeywords.join(", ") || "-"} · 첫 화면 제목: ${script.onScreenTitle ?? "-"}`);
      console.log(`해시태그: ${allHashtags(script).join(" ")} · 댓글 키워드: ${script.commentKeyword}\n저장: ${file}`);
      for (const p of scriptProblems(s, script)) console.log(`⚠️ ${p}`);
      for (const w of lintMetadata(script)) console.log(`💡 ${w}`);
      if (naverAdCred()) console.log(`검색량으로 키워드 고르기: npm run sss -- keywords ${s.id}`);
      return;
    }
    case "seo": {
      const s = loadShort(db, need(rest[0]));
      const warnings = lintMetadata(currentScript(s));
      console.log(warnings.length ? warnings.map((w) => `💡 ${w}`).join("\n") : "✅ 제목·태그·키워드·자막 점검 통과");
      return;
    }
    case "keywords": {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { pick: { type: "string" } } });
      const s = loadShort(db, need(positionals[0]));
      const script = currentScript(s);
      const file = path.join(shortDir(s.id), "script.json");
      if (values.pick) {
        const pick = values.pick.trim();
        script.searchKeywords = [pick, ...script.searchKeywords.filter((k) => k !== pick)].slice(0, 5);
        writeFileSync(file, JSON.stringify(script, null, 2));
        updateShort(db, s.id, { script });
        console.log(`✅ 대표 키워드: ${pick} — 제목·훅·첫 화면 제목에도 넣었는지 확인하세요: npm run sss -- seo ${s.id}`);
        return;
      }
      const cred = naverAdCred();
      if (!cred) throw new Error("네이버 검색광고 API 키가 없어요(.env: NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID — jk-biz 와 같은 값).");
      const hints = script.searchKeywords.length ? script.searchKeywords : [s.productName];
      const ranked = rankKeywords(await keywordVolumes(hints, cred), hints);
      if (!ranked.length) return console.log("관련 검색어를 찾지 못했어요. script.json 의 searchKeywords 를 바꿔 보세요.");
      console.log("월간 모바일 검색량 (경쟁은 광고 경쟁도):");
      for (const k of ranked) console.log(`  ${String(k.monthlyMobile).padStart(7)}  ${k.keyword}  (PC ${k.monthlyPc}, 경쟁 ${k.compIdx || "-"})`);
      console.log(`\n고르기: npm run sss -- keywords ${s.id} --pick "${ranked[0]!.keyword}"  (검색량이 너무 큰 넓은 말보다, 문제를 구체적으로 말하는 중간 크기가 쇼츠 검색에 유리한 경우가 많아요)`);
      return;
    }
    case "stock": {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { role: { type: "string" }, count: { type: "string" } } });
      const s = loadShort(db, need(positionals[0]));
      const query = positionals.slice(1).join(" ").trim();
      if (!query) throw new Error('검색어를 주세요(영어가 결과가 많아요): stock 1 "messy kitchen drawer" --role PROBLEM');
      const role = (values.role?.toUpperCase() ?? "CONTEXT") as Role;
      if (!(role in ROLES) || role === "PRODUCT") throw new Error("스톡 영상의 역할은 PROBLEM, CONTEXT, HOOK 중 하나예요(실제 상품 장면엔 쓸 수 없음).");
      const picks = chooseVideos(await searchPexels(query), usedSourceUrls(db), Number(values.count ?? 3));
      if (!picks.length) throw new Error("쓸 만한 세로 영상을 찾지 못했어요(이미 쓴 영상은 제외). 검색어를 바꿔 보세요.");
      const dir = path.join(shortDir(s.id), "clips");
      mkdirSync(dir, { recursive: true });
      const clips = [...(s.clips as Clip[])];
      for (const { video, file } of picks) {
        const dest = path.join(dir, `${clips.length + 1}-pexels-${video.id}.mp4`);
        await download(file.link, dest);
        clips.push(ClipSchema.parse({ file: dest, kind: "STOCK", role, sourceUrl: video.url, note: `Pexels · ${video.user?.name ?? ""} · ${query}` }));
        console.log(`✅ ${ROLES[role]}: ${video.url} (${video.duration}초)`);
      }
      updateShort(db, s.id, { clips });
      return;
    }
    case "ai-clip": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          products: { type: "string" },
          "no-problem": { type: "boolean" },
          context: { type: "boolean" },
          motion: { type: "string" },
          "dry-run": { type: "boolean" },
          yes: { type: "boolean" },
        },
      });
      const s = loadShort(db, need(positionals[0]));
      const script = currentScript(s);
      const clips = s.clips as Clip[];
      const productImages = clips.filter((c) => c.kind === "PRODUCT_IMAGE");
      if (values.motion) {
        const bad = checkProductPrompt(values.motion);
        if (bad.length) throw new Error(bad.join("\n"));
      }
      if (!productImages.length && Number(values.products ?? 2) > 0) {
        console.log("⚠️ 실제 상품 이미지(PRODUCT_IMAGE)가 없어 상품 영상은 건너뜁니다. clip add ... --kind PRODUCT_IMAGE --role PRODUCT 로 먼저 추가하세요.");
      }
      const jobs = planAiJobs(script, productImages.map((c) => c.file), {
        products: Number(values.products ?? 2),
        problem: !values["no-problem"],
        context: !!values.context,
        customMotion: values.motion,
      });
      if (!jobs.length) throw new Error("만들 장면이 없어요.");
      const credits = estimateCredits(jobs);
      console.log(`생성 계획 (${jobs.length}개):`);
      for (const j of jobs) console.log(`  ${ROLES[j.role].padEnd(6)} ${j.model} ${j.duration}초 ${j.type === "image_to_video" ? `← ${path.basename(j.baseFile!)}` : ""}\n      ${j.prompt}`);
      console.log(credits === null ? "예상 비용: 요금표에 없는 모델이 있어 계산할 수 없어요(Runway 가격표 확인)." : `예상 비용: ${credits} 크레딧 ≈ $${(credits * USD_PER_CREDIT).toFixed(2)}`);
      if (values["dry-run"]) return;
      if (!values.yes && !(await confirm("Runway 크레딧을 써서 생성할까요?"))) return console.log("취소했어요.");

      const client = new RunwayClient();
      const dir = path.join(shortDir(s.id), "clips");
      mkdirSync(dir, { recursive: true });
      const added: Clip[] = [];
      let spent = 0;
      for (const [i, j] of jobs.entries()) {
        const base = j.baseFile ? productImages.find((c) => c.file === j.baseFile) : undefined;
        const image = base ? await productImageDataUri(base.file, path.join(dir, `runway-input-${i}.jpg`)) : undefined;
        console.log(`[${i + 1}/${jobs.length}] ${ROLES[j.role]} 생성 중…`);
        const taskId = await client.submit(j, image);
        const url = await client.wait(taskId);
        const dest = path.join(dir, `${clips.length + added.length + 1}-runway-${j.role.toLowerCase()}-${taskId.slice(0, 8)}.mp4`);
        await downloadFile(url, dest);
        spent += (estimateCredits([j]) ?? 0);
        const clip = ClipSchema.parse(
          base
            ? { file: dest, kind: "AI_FROM_PRODUCT", role: "PRODUCT", sourceUrl: base.sourceUrl, proof: base.proof, derivedFrom: base.file, prompt: j.prompt, model: j.model, note: `Runway ${taskId}` }
            : { file: dest, kind: "AI", role: j.role, prompt: j.prompt, model: j.model, note: `Runway ${taskId}` },
        );
        added.push(clip);
        // 한 편씩 저장 — 중간에 실패해도 이미 만든 장면과 비용 기록은 남깁니다.
        updateShort(db, s.id, { clips: [...clips, ...added], aiCredits: s.aiCredits + spent });
        console.log(`  ✅ ${dest}`);
      }
      console.log(`✅ ${added.length}개 추가 · 약 ${spent} 크레딧($${(spent * USD_PER_CREDIT).toFixed(2)}) — 상품 영상은 모양이 원본과 같은지 꼭 확인하세요. 다음: clip check ${s.id} → render ${s.id}`);
      return;
    }
    case "clip": {
      const [sub, idArg, ...more] = rest;
      const s = loadShort(db, need(idArg));
      if (sub === "check") {
        const problems = checkClips(s.clips as Clip[]);
        const roles = (s.clips as Clip[]).reduce<Record<string, number>>((a, c) => ((a[c.role] = (a[c.role] ?? 0) + 1), a), {});
        console.log(`역할별: ${Object.entries(roles).map(([r, n]) => `${ROLES[r as Role]} ${n}`).join(", ") || "없음"}`);
        if (!roles.PRODUCT) console.log("⚠️ 실제 상품 장면(PRODUCT)이 없어요 — 상품 이미지를 --kind PRODUCT_IMAGE --role PRODUCT 로 추가하세요.");
        console.log(problems.length ? problems.map((p) => `❌ ${p}`).join("\n") : `✅ 소스 ${s.clips.length}개 모두 사용 가능`);
        return;
      }
      if (sub !== "add") throw new Error("clip add | clip check");
      const { values, positionals } = parseArgs({
        args: more,
        allowPositionals: true,
        options: { kind: { type: "string" }, role: { type: "string" }, source: { type: "string" }, proof: { type: "string" }, note: { type: "string" } },
      });
      const src = positionals[0];
      if (!src || !existsSync(src)) throw new Error("로컬 파일 경로를 주세요(스톡에서 받은 파일, 상품 이미지 등).");
      const dir = path.join(shortDir(s.id), "clips");
      mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${s.clips.length + 1}-${path.basename(src)}`);
      const clip = ClipSchema.parse({
        file: dest,
        kind: values.kind?.toUpperCase() as SourceKind,
        role: values.role?.toUpperCase(),
        sourceUrl: values.source,
        proof: values.proof,
        note: values.note,
      });
      const problems = checkClips([clip]);
      if (problems.length) throw new Error(problems.join("\n"));
      copyFileSync(src, dest);
      updateShort(db, s.id, { clips: [...s.clips, clip] });
      console.log(`✅ 소스 추가: ${dest} (${SOURCE_KINDS[clip.kind]} · ${ROLES[clip.role]})`);
      return;
    }
    case "render": {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { voice: { type: "string" }, sw: { type: "boolean" }, speed: { type: "string" } } });
      const s = loadShort(db, need(positionals[0]));
      const script = currentScript(s);
      const problems = scriptProblems(s, script);
      if (problems.length) throw new Error(`${problems.join("\n")}\n→ ${path.join(shortDir(s.id), "script.json")} 를 고치세요.`);
      const clips = s.clips as Clip[];
      const clipProblems = checkClips(clips);
      if (clipProblems.length) throw new Error(`소스 점검 실패:\n${clipProblems.join("\n")}`);

      const dir = shortDir(s.id);
      const lines = narration(script);
      const speed = Number(values.speed ?? process.env.SSS_SPEED ?? 1.1);
      console.log(values.voice ? "외부 음성 정리 중(무음 제거·속도·자막 맞추기)…" : `음성 합성 중(${providerFromEnv()})…`);
      const { audio, segments } = values.voice
        ? await prepareExternalVoice(path.resolve(values.voice), lines.map((l) => l.text), path.join(dir, "voice"), speed)
        : await synthesize(lines.map((l) => l.text), path.join(dir, "tts"), { speed });
      const roleSegments: RoleSegment[] = segments.map((seg, i) => ({ ...seg, role: lines[i]!.role }));

      const durations = new Map<string, number>();
      for (const c of clips) if (!isImage(c.file)) durations.set(c.file, await probeDuration(c.file));
      const shots = planShots(clips, roleSegments, durations, { seed: s.id });

      const assFile = path.join(dir, "subs.ass");
      writeFileSync(assFile, buildAss(segments, ON_SCREEN_DISCLOSURE, { titleCard: script.onScreenTitle, emphasis: lines.map((l) => l.emphasis) }));
      const out = path.join(dir, `short-${s.id}.mp4`);
      console.log(`렌더 중(ffmpeg, 컷 ${shots.length}개)…`);
      try {
        await runOk("ffmpeg", buildRenderArgs({ shots, audio, assFile, out, hardware: !values.sw }));
      } catch (e) {
        if (values.sw) throw e;
        console.log("하드웨어 인코더 실패 → 소프트웨어(libx264)로 다시 시도");
        await runOk("ffmpeg", buildRenderArgs({ shots, audio, assFile, out, hardware: false }));
      }
      updateShort(db, s.id, { script, videoPath: out, status: "RENDERED", ...metaOf(script) });
      console.log(`✅ ${out} (${(await probeDuration(out)).toFixed(1)}초) — 재생해 확인한 뒤: npm run sss -- export ${s.id}`);
      return;
    }
    case "export": {
      const s = loadShort(db, need(rest[0]));
      const script = currentScript(s);
      const problems = [...scriptProblems(s, script), ...checkClips(s.clips as Clip[])];
      if (problems.length) throw new Error(problems.join("\n"));
      if (!s.videoPath || !existsSync(s.videoPath)) throw new Error("렌더된 영상이 없어요. 먼저 render 하세요.");
      for (const w of lintMetadata(script)) console.log(`💡 ${w}`);
      const dir = writeExport(s, script);
      updateShort(db, s.id, { ...metaOf(script), ...(["RENDERED", "SCRIPTED", "DRAFT"].includes(s.status) ? { status: "EXPORTED" as const } : {}) });
      console.log(`✅ ${dir}\n   short-${s.id}.mp4, instagram.txt, youtube.txt, tiktok.txt, naver.txt, links.txt\n   에어드롭·아이클라우드로 폰에 보낸 뒤: npm run sss -- approve ${s.id}`);
      return;
    }
    case "approve": {
      const s = loadShort(db, need(rest[0]));
      if (!["EXPORTED", "PRIVATE", "RENDERED"].includes(s.status)) throw new Error(`렌더·내보내기 후에 검수할 수 있어요(현재 ${s.status}).`);
      const hasAi = (s.clips as Clip[]).some((c) => AI_KINDS.includes(c.kind));
      const hasAiProduct = (s.clips as Clip[]).some((c) => c.kind === "AI_FROM_PRODUCT");
      console.log(`올리기 전 검수 — ${s.videoPath}
  1. 모든 장면이 스톡·AI·상품 이미지 등 쓸 수 있는 소스인가요? (다른 사람 영상 없음)
  2. '실제 상품' 장면이 진짜 그 상품인가요? (AI·스톡을 상품처럼 보여 주지 않음)
  3. 대사에 사실과 다른 내용, 지어낸 사용 경험, 과장이 없나요?
  4. 화면 상단 광고 표기가 보이고, 캡션 첫 줄에 "${COUPANG_DISCLOSURE}" 가 있나요?
  5. 각 앱의 광고 표시(유료 프로모션·브랜드 콘텐츠)를 켤 준비가 됐나요?
  6. 프로필 링크·댓글 키워드 DM 이 이 제품 링크로 연결되나요? (${exportDir(s.id)}/links.txt)${
    hasAiProduct
      ? "\n  7. AI 로 움직인 상품 영상: 상품 모양·색·크기·부품이 원본 이미지와 같나요? 상품이 무언가를 해내는(닦기·정리 등) 연출이 없나요?"
      : ""
  }${hasAi ? "\n  8. AI 장면이 들어 있어요 — 각 앱의 'AI 생성 콘텐츠' 표시(유튜브: 변경·합성 콘텐츠, 인스타: AI 정보)를 켜세요." : ""}`);
      if (!(await confirm("모두 확인했나요?"))) return console.log("승인하지 않았어요.");
      updateShort(db, s.id, { status: "APPROVED" });
      console.log(`✅ 승인. 폰으로 올린 뒤: npm run sss -- posted ${s.id}`);
      return;
    }
    case "posted": {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { at: { type: "string" } } });
      const s = loadShort(db, need(positionals[0]));
      if (s.status !== "APPROVED") throw new Error(`사람이 승인한 쇼츠만 올릴 수 있어요(현재 ${s.status}). approve 를 먼저 하세요.`);
      updateShort(db, s.id, { status: "PUBLISHED", postedAt: postedAt(values.at) });
      console.log(`✅ #${s.id} 공개됨으로 기록. 며칠 뒤 성과: npm run sss -- track ${s.id} --platform INSTAGRAM --views ...`);
      return;
    }
    case "youtube": {
      if (rest[0] !== "auth") throw new Error("youtube auth");
      await authorize();
      return;
    }
    case "upload": {
      const s = loadShort(db, need(rest[0]));
      if (!s.videoPath || !existsSync(s.videoPath)) throw new Error("렌더된 영상이 없어요. 먼저 render 하세요.");
      const script = currentScript(s);
      const problems = [...scriptProblems(s, script), ...checkClips(s.clips as Clip[])];
      if (problems.length) throw new Error(problems.join("\n"));
      const r = await uploadPrivate(s.videoPath, {
        title: `${script.titles[0]} #shorts`,
        description: [COUPANG_DISCLOSURE, "", "제품 정보는 채널 프로필 링크에서 확인하세요.", "", allHashtags(script).slice(0, 3).join(" ")].join("\n"),
        tags: [...script.searchKeywords, ...allHashtags(script).map((h) => h.replace(/^#/, ""))],
        syntheticMedia: (s.clips as Clip[]).some((c) => AI_KINDS.includes(c.kind)),
      });
      updateShort(db, s.id, { remoteUrl: r.url, status: "PRIVATE" });
      console.log(`✅ 비공개 업로드: ${r.url}\n유튜브 스튜디오에서 확인 후: npm run sss -- approve ${s.id}`);
      return;
    }
    case "publish": {
      const s = loadShort(db, need(rest[0]));
      if (s.status !== "APPROVED") throw new Error(`사람이 승인한 쇼츠만 공개할 수 있어요(현재 ${s.status}). approve 를 먼저 하세요.`);
      const vid = s.remoteUrl ? videoIdOf(s.remoteUrl) : null;
      if (!vid) throw new Error("유튜브 API 로 올린 영상이 아니에요. 폰으로 올렸다면: posted");
      await makePublic(vid);
      updateShort(db, s.id, { status: "PUBLISHED" });
      console.log(`✅ 공개: ${s.remoteUrl}`);
      return;
    }
    case "track": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          date: { type: "string" },
          platform: { type: "string" },
          source: { type: "string" },
          views: { type: "string" },
          clicks: { type: "string" },
          orders: { type: "string" },
          commission: { type: "string" },
          minutes: { type: "string" },
        },
      });
      const s = loadShort(db, need(positionals[0]));
      if (values.minutes !== undefined) updateShort(db, s.id, { minutes: num(values.minutes)! });
      if (values.views === undefined && values.clicks === undefined && values.orders === undefined && values.commission === undefined) {
        if (values.minutes !== undefined) console.log(`✅ #${s.id} 제작 시간 ${values.minutes}분`);
        return;
      }
      const platform = toPlatform(values.platform);
      const date = values.date ?? today();
      recordMetric(db, {
        shortId: s.id,
        date,
        platform,
        source: toSource(values.source, platform),
        views: num(values.views),
        clicks: num(values.clicks),
        orders: num(values.orders),
        commission: num(values.commission),
      });
      console.log(`✅ #${s.id} ${platform} ${date} 기록`);
      return;
    }
    case "track-channel": {
      const { values } = parseArgs({ args: rest, options: { date: { type: "string" }, platform: { type: "string" }, followers: { type: "string" }, views90: { type: "string" } } });
      const platform = toPlatform(values.platform, "YOUTUBE");
      recordChannel(db, { date: values.date ?? today(), platform, followers: num(values.followers), views90d: num(values.views90) });
      console.log(`✅ ${platform} 채널 기록`);
      return;
    }
    case "report": {
      const { values } = parseArgs({ args: rest, options: { by: { type: "string" } } });
      const rows = report(db);
      if (values.by) {
        if (!(GROUP_BY as readonly string[]).includes(values.by)) throw new Error(`--by 는 ${GROUP_BY.join(", ")} 중 하나예요.`);
        const groups = groupReport(rows, values.by as GroupBy);
        if (!groups.length) return console.log("공개된 쇼츠가 없어요(posted 로 기록).");
        console.log(`${{ hook: "훅 유형", keyword: "대표 키워드", hour: "올린 시간대" }[values.by as GroupBy]}별 (공개된 쇼츠, 조회수 중앙값 순)`);
        for (const g of groups) {
          console.log(`  ${g.group.padEnd(12)} ${String(g.count).padStart(3)}편  중앙값 ${g.medianViews.toLocaleString().padStart(9)}  수수료 ${g.commission.toLocaleString()}원${g.enough ? "" : `  (표본 부족 <${MIN_SAMPLE}편)`}`);
        }
        return;
      }
      console.log("id\t상태\t\t분\t조회(합)\t클릭\t주문\t수수료\t플랫폼별 조회\t제품");
      for (const r of rows) {
        const by = Object.entries(r.byPlatform).map(([p, v]) => `${p[0]}${v}`).join(" ") || "-";
        console.log(`#${r.id}\t${r.status.padEnd(9)}\t${r.minutes}\t${r.views}\t${r.clicks}\t${r.orders}\t${r.commission}\t${by}\t${r.productName}`);
      }
      const s = summarize(rows);
      console.log(
        `\n공개 ${s.published}/${s.count}편 · 조회수 중앙값 ${s.medianViews} · 클릭률 ${(s.ctr * 100).toFixed(2)}% · 누적 수수료 ${s.commission.toLocaleString()}원 · 편당 ${s.perShort.toLocaleString()}원 · 제작 ${s.hours.toFixed(1)}시간 · 시간당 ${s.perHour.toLocaleString()}원 · AI 비용 $${s.aiUsd.toFixed(2)}`,
      );
      const ch = latestChannel(db);
      for (const c of ch) console.log(`${c.platform} ${c.date}: 팔로워/구독자 ${c.followers.toLocaleString()} · 90일 조회 ${c.views90d.toLocaleString()}`);
      const ypp = yppProgress(ch, { subs: num(process.env.SSS_YPP_SUBS), shortsViews90d: num(process.env.SSS_YPP_SHORTS_VIEWS) });
      if (ypp) console.log(`유튜브 수익창출 조건: 구독자 ${(ypp.subs * 100).toFixed(0)}% · 90일 쇼츠 조회 ${(ypp.views * 100).toFixed(0)}%`);
      else console.log("유튜브 수익창출 조건 진행률: .env 에 SSS_YPP_SUBS / SSS_YPP_SHORTS_VIEWS 를 넣으면 표시돼요(유튜브 고객센터 기준 확인).");
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e: Error) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
