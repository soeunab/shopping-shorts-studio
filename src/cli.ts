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
  generateScript,
  narration,
  ON_SCREEN_DISCLOSURE,
  placeholdersIn,
  ScriptSchema,
  type Script,
} from "./script/generate.js";
import { checkClips, ClipSchema, ROLES, SOURCE_KINDS, type Clip, type Role, type SourceKind } from "./sources/license.js";
import { chooseVideos, download, searchPexels } from "./sources/pexels.js";

try {
  process.loadEnvFile(".env");
} catch {}

const HELP = `쇼핑쇼츠 스튜디오 (합법 소스 전용 · 정보형 쇼핑쇼츠)

준비
  doctor                                   환경 점검(ffmpeg·음성·Claude Code·API 키)
제작
  new "<제품명>" [--url 쿠팡링크] [--naver-url 쇼핑커넥트링크] [--category 주방] [--fact "..."]...
  score <id> [--novel] [--solves "해결하는 문제"] [--season] [--category C]   제품 선정 4기준 (옵션 없으면 질문)
  script <id>                              대본 생성 → data/shorts/<id>/script.json (훅 고르기: hookIndex)
  stock <id> "<영어 검색어>" [--role PROBLEM|CONTEXT|HOOK] [--count 3]     Pexels 무료 스톡 자동 받기
  clip add <id> <파일> --kind ${Object.keys(SOURCE_KINDS).join("|")} --role ${Object.keys(ROLES).join("|")} [--source URL] [--proof 근거]
  clip check <id>                          소스 라이선스·역할 점검
  render <id> [--speed 1.15] [--voice 음성파일] [--sw]   음성·한 줄 자막·2~3초 컷으로 1080x1920 mp4
올리기
  export <id>                              폰 업로드용 mp4 + 플랫폼별 캡션(instagram/youtube/tiktok/naver) + links.txt
  approve <id>                             올리기 전 사람 검수 체크리스트
  posted <id>                              폰으로 올린 뒤 '공개됨' 기록
  youtube auth | upload <id> | publish <id>   (선택) 유튜브 API 비공개 업로드 → 승인 후 공개
기록
  track <id> --platform ${PLATFORMS.join("|")} [--views N] [--clicks N] [--orders N] [--commission 원] [--source S] [--minutes 제작분]
  track-channel --platform YOUTUBE|INSTAGRAM|... [--followers N] [--views90 N]
  report                                   성과·시간당 수익·수익창출 조건 진행률`;

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
        category: values.category ?? channelCategory(),
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
      console.log(`제목 후보: ${script.titles.join(" / ")}\n댓글 키워드: ${script.commentKeyword}\n저장: ${file}`);
      for (const p of scriptProblems(s, script)) console.log(`⚠️ ${p}`);
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
      writeFileSync(assFile, buildAss(segments, ON_SCREEN_DISCLOSURE));
      const out = path.join(dir, `short-${s.id}.mp4`);
      console.log(`렌더 중(ffmpeg, 컷 ${shots.length}개)…`);
      try {
        await runOk("ffmpeg", buildRenderArgs({ shots, audio, assFile, out, hardware: !values.sw }));
      } catch (e) {
        if (values.sw) throw e;
        console.log("하드웨어 인코더 실패 → 소프트웨어(libx264)로 다시 시도");
        await runOk("ffmpeg", buildRenderArgs({ shots, audio, assFile, out, hardware: false }));
      }
      updateShort(db, s.id, { script, videoPath: out, status: "RENDERED" });
      console.log(`✅ ${out} (${(await probeDuration(out)).toFixed(1)}초) — 재생해 확인한 뒤: npm run sss -- export ${s.id}`);
      return;
    }
    case "export": {
      const s = loadShort(db, need(rest[0]));
      const script = currentScript(s);
      const problems = [...scriptProblems(s, script), ...checkClips(s.clips as Clip[])];
      if (problems.length) throw new Error(problems.join("\n"));
      if (!s.videoPath || !existsSync(s.videoPath)) throw new Error("렌더된 영상이 없어요. 먼저 render 하세요.");
      const dir = writeExport(s, script);
      if (["RENDERED", "SCRIPTED", "DRAFT"].includes(s.status)) updateShort(db, s.id, { status: "EXPORTED" });
      console.log(`✅ ${dir}\n   short-${s.id}.mp4, instagram.txt, youtube.txt, tiktok.txt, naver.txt, links.txt\n   에어드롭·아이클라우드로 폰에 보낸 뒤: npm run sss -- approve ${s.id}`);
      return;
    }
    case "approve": {
      const s = loadShort(db, need(rest[0]));
      if (!["EXPORTED", "PRIVATE", "RENDERED"].includes(s.status)) throw new Error(`렌더·내보내기 후에 검수할 수 있어요(현재 ${s.status}).`);
      const hasAi = (s.clips as Clip[]).some((c) => c.kind === "AI");
      console.log(`올리기 전 검수 — ${s.videoPath}
  1. 모든 장면이 스톡·AI·상품 이미지 등 쓸 수 있는 소스인가요? (다른 사람 영상 없음)
  2. '실제 상품' 장면이 진짜 그 상품인가요? (AI·스톡을 상품처럼 보여 주지 않음)
  3. 대사에 사실과 다른 내용, 지어낸 사용 경험, 과장이 없나요?
  4. 화면 상단 광고 표기가 보이고, 캡션 첫 줄에 "${COUPANG_DISCLOSURE}" 가 있나요?
  5. 각 앱의 광고 표시(유료 프로모션·브랜드 콘텐츠)를 켤 준비가 됐나요?${hasAi ? "\n  6. AI 이미지가 들어 있어요 — 각 앱의 'AI 생성 콘텐츠' 표시를 켜세요." : ""}
  ${hasAi ? 7 : 6}. 프로필 링크·댓글 키워드 DM 이 이 제품 링크로 연결되나요? (${exportDir(s.id)}/links.txt)`);
      if (!(await confirm("모두 확인했나요?"))) return console.log("승인하지 않았어요.");
      updateShort(db, s.id, { status: "APPROVED" });
      console.log(`✅ 승인. 폰으로 올린 뒤: npm run sss -- posted ${s.id}`);
      return;
    }
    case "posted": {
      const s = loadShort(db, need(rest[0]));
      if (s.status !== "APPROVED") throw new Error(`사람이 승인한 쇼츠만 올릴 수 있어요(현재 ${s.status}). approve 를 먼저 하세요.`);
      updateShort(db, s.id, { status: "PUBLISHED" });
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
        description: [COUPANG_DISCLOSURE, "", "제품 정보는 채널 프로필 링크에서 확인하세요.", "", script.hashtags.join(" ")].join("\n"),
        tags: script.hashtags.map((h) => h.replace(/^#/, "")),
        syntheticMedia: (s.clips as Clip[]).some((c) => c.kind === "AI"),
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
      const rows = report(db);
      console.log("id\t상태\t\t분\t조회(합)\t클릭\t주문\t수수료\t플랫폼별 조회\t제품");
      for (const r of rows) {
        const by = Object.entries(r.byPlatform).map(([p, v]) => `${p[0]}${v}`).join(" ") || "-";
        console.log(`#${r.id}\t${r.status.padEnd(9)}\t${r.minutes}\t${r.views}\t${r.clicks}\t${r.orders}\t${r.commission}\t${by}\t${r.productName}`);
      }
      const s = summarize(rows);
      console.log(
        `\n공개 ${s.published}/${s.count}편 · 조회수 중앙값 ${s.medianViews} · 클릭률 ${(s.ctr * 100).toFixed(2)}% · 누적 수수료 ${s.commission.toLocaleString()}원 · 편당 ${s.perShort.toLocaleString()}원 · 제작 ${s.hours.toFixed(1)}시간 · 시간당 ${s.perHour.toLocaleString()}원`,
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
