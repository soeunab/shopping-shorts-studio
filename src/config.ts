import path from "node:path";

/** 작업 데이터(DB·영상·중간 산출물) 위치. 저장소에는 커밋하지 않습니다(.gitignore). */
export function dataDir(): string {
  return path.resolve(process.env.SSS_DATA?.trim() || "data");
}

export function dbPath(): string {
  return path.join(dataDir(), "studio.db");
}

export function shortDir(id: number): string {
  return path.join(dataDir(), "shorts", String(id));
}
