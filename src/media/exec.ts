import { spawn } from "node:child_process";

export async function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs) : null;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function runOk(cmd: string, args: string[]): Promise<string> {
  const r = await run(cmd, args);
  if (r.code !== 0) throw new Error(`${cmd} 실패 (코드 ${r.code}): ${r.stderr.slice(-800)}`);
  return r.stdout;
}

/** 미디어 길이(초) */
export async function probeDuration(file: string): Promise<number> {
  const out = await runOk("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = Number.parseFloat(out.trim());
  if (!Number.isFinite(d)) throw new Error(`${file} 의 길이를 읽지 못했어요.`);
  return d;
}
