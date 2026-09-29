import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { shortDir } from "./config.js";
import { createShort, getShort, listShorts, openDb, recordMetric, report, summarize, updateShort, type ShortRow } from "./db.js";
import { doctor } from "./doctor.js";
import { probeDuration, runOk } from "./media/exec.js";
import { buildRenderArgs, planShots } from "./media/render.js";
import { buildAss } from "./media/subtitles.js";
import { estimateSegments, synthesize } from "./media/tts.js";
import { authorize, makePublic, uploadPrivate, videoIdOf } from "./publish/youtube.js";
import { buildDescription, disclosureFor, generateScript, narrationLines, placeholdersIn, ScriptSchema, type Script } from "./script/generate.js";
import { checkClips, ClipSchema, SOURCE_KINDS, type Clip, type SourceKind } from "./sources/license.js";

try {
  process.loadEnvFile(".env");
} catch {}

const HELP = `쇼핑쇼츠 스튜디오 (합법 소스 전용)

  doctor                                   맥 환경 점검(ffmpeg·한국어 음성·Claude Code)
  new "<제품명>" [--url U] [--category C] [--program COUPANG|SHOPPING_CONNECT] [--fact "..."]...
  list                                     쇼츠 목록
  show <id>                                상세
  script <id>                              대본 생성 → data/shorts/<id>/script.json (직접 고쳐도 됨)
  clip add <id> <파일> --kind ${Object.keys(SOURCE_KINDS).join("|")} [--source URL] [--proof 근거]
  clip check <id>                          소스 라이선스 점검
  render <id> [--voice 음성파일] [--sw]    TTS·자막·ffmpeg 로 1080x1920 mp4 제작
  youtube auth                             유튜브 채널 연결(한 번)
  upload <id>                              유튜브에 "비공개"로 업로드
  approve <id>                             사람 검수 체크리스트 → 승인
  publish <id>                             승인된 쇼츠만 공개 전환
  track <id> [--date YYYY-MM-DD] [--views N] [--clicks N] [--orders N] [--commission 원]
  report                                   성과 표 + Phase 0 판단 요약`;

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

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} (y/N) `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const db = openDb();

  switch (cmd) {
    case "doctor": {
      const checks = await doctor();
      for (const c of checks) console.log(`${c.ok ? "✅" : "❌"} ${c.name} — ${c.detail}${!c.ok && c.fix ? `\n   → ${c.fix}` : ""}`);
      return;
    }
    case "new": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { url: { type: "string" }, category: { type: "string" }, program: { type: "string" }, fact: { type: "string", multiple: true } },
      });
      const name = positionals.join(" ").trim();
      if (!name) throw new Error('제품명을 주세요: new "실리콘 아이스크림 틀"');
      const program = values.program === "SHOPPING_CONNECT" ? "SHOPPING_CONNECT" : "COUPANG";
      const s = createShort(db, { productName: name, productUrl: values.url, category: values.category, program, facts: values.fact ?? [] });
      console.log(`✅ #${s.id} ${s.productName} 등록. 다음: npm run sss -- script ${s.id}`);
      return;
    }
    case "list": {
      for (const s of listShorts(db)) console.log(`#${s.id}\t${s.status}\t${s.category ?? "-"}\t${s.productName}${s.remoteUrl ? `\t${s.remoteUrl}` : ""}`);
      return;
    }
    case "show": {
      console.log(JSON.stringify(loadShort(db, need(rest[0])), null, 2));
      return;
    }
    case "script": {
      const s = loadShort(db, need(rest[0]));
      console.log("대본 생성 중(Claude Code 구독)…");
      const script = await generateScript(s);
      mkdirSync(shortDir(s.id), { recursive: true });
      const file = path.join(shortDir(s.id), "script.json");
      writeFileSync(file, JSON.stringify(script, null, 2));
      updateShort(db, s.id, { script, status: "SCRIPTED" });
      console.log(narrationLines(script).map((l, i) => `${i + 1}. ${l}`).join("\n"));
      const ph = placeholdersIn(script);
      console.log(`\n저장: ${file}`);
      if (ph.length) console.log(`⚠️ [경험 추가] ${ph.length}곳 — 직접 확인한 내용으로 채우거나 문장을 지운 뒤 렌더하세요.`);
      return;
    }
    case "clip": {
      const [sub, idArg, ...more] = rest;
      const s = loadShort(db, need(idArg));
      if (sub === "check") {
        const problems = checkClips(s.clips as Clip[]);
        console.log(problems.length ? problems.map((p) => `❌ ${p}`).join("\n") : `✅ 소스 ${s.clips.length}개 모두 사용 가능`);
        return;
      }
      if (sub !== "add") throw new Error("clip add | clip check");
      const { values, positionals } = parseArgs({
        args: more,
        allowPositionals: true,
        options: { kind: { type: "string" }, source: { type: "string" }, proof: { type: "string" }, note: { type: "string" } },
      });
      const src = positionals[0];
      if (!src || !existsSync(src)) throw new Error("로컬 파일 경로를 주세요(직접 촬영본·스톡에서 받은 파일 등).");
      const dir = path.join(shortDir(s.id), "clips");
      mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${s.clips.length + 1}-${path.basename(src)}`);
      const clip = ClipSchema.parse({ file: dest, kind: values.kind as SourceKind, sourceUrl: values.source, proof: values.proof, note: values.note });
      const problems = checkClips([clip]);
      if (problems.length) throw new Error(problems.join("\n"));
      copyFileSync(src, dest);
      updateShort(db, s.id, { clips: [...s.clips, clip] });
      console.log(`✅ 소스 추가: ${dest} (${SOURCE_KINDS[clip.kind]})`);
      return;
    }
    case "render": {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { voice: { type: "string" }, sw: { type: "boolean" } } });
      const s = loadShort(db, need(positionals[0]));
      const script = currentScript(s);
      const ph = placeholdersIn(script);
      if (ph.length) throw new Error(`대본에 [경험 추가] 가 남아 있어요:\n${ph.join("\n")}\n→ ${path.join(shortDir(s.id), "script.json")} 를 고치세요.`);
      const clips = s.clips as Clip[];
      const problems = checkClips(clips);
      if (problems.length) throw new Error(`소스 점검 실패:\n${problems.join("\n")}`);

      const dir = shortDir(s.id);
      const lines = narrationLines(script);
      let audio: string;
      let segments;
      if (values.voice) {
        audio = path.resolve(values.voice);
        segments = estimateSegments(lines, await probeDuration(audio));
      } else {
        console.log("음성 합성 중(macOS say)…");
        ({ audio, segments } = await synthesize(lines, path.join(dir, "tts")));
      }
      const assFile = path.join(dir, "subs.ass");
      writeFileSync(assFile, buildAss(segments, "광고 · " + (s.program === "COUPANG" ? "쿠팡 파트너스" : "쇼핑커넥트") + " 수수료를 받을 수 있어요"));
      const out = path.join(dir, `short-${s.id}.mp4`);
      const args = buildRenderArgs({ shots: planShots(clips, segments), audio, assFile, out, hardware: !values.sw });
      console.log("렌더 중(ffmpeg)…");
      try {
        await runOk("ffmpeg", args);
      } catch (e) {
        if (values.sw) throw e;
        console.log("하드웨어 인코더 실패 → 소프트웨어(libx264)로 다시 시도");
        await runOk("ffmpeg", buildRenderArgs({ shots: planShots(clips, segments), audio, assFile, out, hardware: false }));
      }
      updateShort(db, s.id, { script, videoPath: out, status: "RENDERED" });
      console.log(`✅ ${out} (${(await probeDuration(out)).toFixed(1)}초) — 직접 재생해 확인한 뒤 upload 하세요.`);
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
      const problems = checkClips(s.clips as Clip[]);
      if (problems.length) throw new Error(`소스 점검 실패:\n${problems.join("\n")}`);
      const script = currentScript(s);
      const r = await uploadPrivate(s.videoPath, {
        title: `${script.title} #shorts`,
        description: buildDescription(s, script),
        tags: script.hashtags.map((h) => h.replace(/^#/, "")),
        syntheticMedia: (s.clips as Clip[]).some((c) => c.kind === "AI"),
      });
      updateShort(db, s.id, { remoteUrl: r.url, status: "PRIVATE" });
      console.log(`✅ 비공개 업로드: ${r.url}\n유튜브 스튜디오에서 확인 후: npm run sss -- approve ${s.id}`);
      return;
    }
    case "approve": {
      const s = loadShort(db, need(rest[0]));
      if (s.status !== "PRIVATE") throw new Error(`비공개 업로드된 쇼츠만 승인할 수 있어요(현재 ${s.status}).`);
      console.log(`검수 체크리스트 — ${s.remoteUrl}
  1. 영상에 들어간 모든 장면이 직접 촬영·스톡·허락·AI 소스인가요? (다른 사람 영상 없음)
  2. 대사에 사실과 다른 내용·지어낸 경험·과장이 없나요?
  3. 상단 대가 표기가 보이고, 설명란 첫 줄에 "${disclosureFor(s.program)}" 가 있나요?
  4. 유튜브 스튜디오 → 세부정보 → '유료 프로모션 포함'을 체크했나요?
  5. 프로필/고정 댓글의 제휴 링크가 이 제품으로 연결되나요?`);
      if (!(await confirm("모두 확인했나요?"))) return console.log("승인하지 않았어요.");
      updateShort(db, s.id, { status: "APPROVED" });
      console.log(`✅ 승인. 공개: npm run sss -- publish ${s.id}`);
      return;
    }
    case "publish": {
      const s = loadShort(db, need(rest[0]));
      if (s.status !== "APPROVED") throw new Error(`사람이 승인한 쇼츠만 공개할 수 있어요(현재 ${s.status}). approve 를 먼저 하세요.`);
      const vid = s.remoteUrl ? videoIdOf(s.remoteUrl) : null;
      if (!vid) throw new Error("업로드된 영상 ID 를 찾지 못했어요.");
      await makePublic(vid);
      updateShort(db, s.id, { status: "PUBLISHED" });
      console.log(`✅ 공개: ${s.remoteUrl}`);
      return;
    }
    case "track": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { date: { type: "string" }, views: { type: "string" }, clicks: { type: "string" }, orders: { type: "string" }, commission: { type: "string" } },
      });
      const s = loadShort(db, need(positionals[0]));
      const num = (v?: string) => (v === undefined ? undefined : Number(v.replaceAll(",", "")));
      const date = values.date ?? new Date().toISOString().slice(0, 10);
      recordMetric(db, { shortId: s.id, date, views: num(values.views), clicks: num(values.clicks), orders: num(values.orders), commission: num(values.commission) });
      console.log(`✅ #${s.id} ${date} 기록`);
      return;
    }
    case "report": {
      const rows = report(db);
      console.log("id\t상태\t조회\t클릭\t주문\t수수료\t제품");
      for (const r of rows) console.log(`#${r.id}\t${r.status}\t${r.views}\t${r.clicks}\t${r.orders}\t${r.commission}\t${r.productName}`);
      const s = summarize(rows);
      console.log(`\n공개 ${s.published}/${s.count}편 · 조회수 중앙값 ${s.medianViews} · 클릭률 ${(s.ctr * 100).toFixed(2)}% · 누적 수수료 ${s.commission.toLocaleString()}원 · 편당 ${s.perShort.toLocaleString()}원`);
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
