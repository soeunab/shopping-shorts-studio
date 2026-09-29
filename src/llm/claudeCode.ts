import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Claude Code(구독) 호출 — 맥에 설치된 `claude` CLI 를 헤드리스(-p)로 실행합니다.
 * - API 과금이 아니라 구독 로그인으로 동작하도록 API 키 환경변수를 제거합니다.
 * - 도구는 모두 끄고(--tools ""), 빈 임시 폴더에서 실행합니다.
 */
export class ClaudeCodeError extends Error {
  constructor(message: string, readonly kind: "not-installed" | "login" | "limit" | "timeout" | "failed") {
    super(message);
  }
}

export function claudeBin(): string | null {
  const configured = process.env.CLAUDE_CODE_BIN?.trim();
  const candidates = configured ? [configured] : (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "claude"));
  for (const c of [...candidates, "/opt/homebrew/bin/claude", "/usr/local/bin/claude", path.join(process.env.HOME ?? "", ".claude/local/claude")]) {
    try {
      accessSync(c, constants.X_OK);
      return c;
    } catch {}
  }
  return null;
}

/** 구독 로그인으로 실행되도록 API 과금 경로의 환경변수를 제거 */
export function subscriptionEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const e = { ...base };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) delete e[k];
  return e;
}

export type ClaudeCodeRequest = { system: string; prompt: string; jsonSchema?: object; model?: string; timeoutMs?: number };

export function claudeCodeArgs(req: ClaudeCodeRequest): string[] {
  const args = [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--model", req.model || process.env.CLAUDE_CODE_MODEL?.trim() || "sonnet",
    "--system-prompt", req.system,
    "--tools", "",
  ];
  if (req.jsonSchema) {
    const { $schema: _drop, ...schema } = req.jsonSchema as Record<string, unknown>;
    args.push("--json-schema", JSON.stringify(schema));
  }
  return args;
}

export function classifyClaudeError(text: string): ClaudeCodeError {
  if (/usage limit|rate limit|limit reached|quota|too many requests|429/i.test(text)) {
    return new ClaudeCodeError("Claude 구독 사용 한도에 도달했어요. 한도가 풀리면 다시 시도하세요.", "limit");
  }
  if (/log ?in|authenticat|unauthori[sz]ed|not logged|invalid api key|oauth|credential|401/i.test(text)) {
    return new ClaudeCodeError("Claude Code 로그인이 필요해요. 터미널에서 claude 를 실행해 /login 으로 구독 계정에 로그인하세요.", "login");
  }
  return new ClaudeCodeError(`Claude Code 실행 실패: ${text.slice(0, 300)}`, "failed");
}

export async function runClaudeCode(req: ClaudeCodeRequest): Promise<{ text: string; structured?: unknown }> {
  const bin = claudeBin();
  if (!bin) throw new ClaudeCodeError("Claude Code(claude 명령)가 없어요. 설치 후 구독 계정으로 로그인하세요.", "not-installed");
  const cwd = mkdtempSync(path.join(tmpdir(), "sss-claude-"));
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(bin, claudeCodeArgs(req), { cwd, env: subscriptionEnv(), stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new ClaudeCodeError("Claude Code 응답 시간이 초과됐어요.", "timeout"));
      }, req.timeoutMs ?? 300_000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new ClaudeCodeError(`Claude Code 실행 실패: ${e.message}`, "failed"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) return reject(classifyClaudeError(stderr || `종료 코드 ${code}`));
        resolve(stdout);
      });
      child.stdin.end(req.prompt);
    });
    let parsed: { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string };
    try {
      parsed = JSON.parse(out);
    } catch {
      return { text: out };
    }
    if (parsed.is_error) throw classifyClaudeError(`${parsed.subtype ?? ""} ${parsed.result ?? ""}`);
    return { text: parsed.result ?? "", structured: parsed.structured_output };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
