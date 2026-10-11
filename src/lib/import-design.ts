import { decodeConfigWithMigration } from "./config-code";

/** Accept either a standalone code or the full text produced by the order list. */
export function decodePastedDesign(input: string) {
  if (typeof input !== "string" || input.length > 200_000) {
    throw new Error("搭配清单过长，请只粘贴一份清单或搭配编号");
  }
  const text = input.trim();
  // Capture the entire token: a damaged checksum must reach the strict decoder,
  // never be silently truncated into an apparently valid code.
  const candidates = text.match(/HM\d+\.[A-Za-z0-9_.-]+/g) ?? [];
  const unique = [...new Set(candidates)];
  if (unique.length > 1) throw new Error("发现多个搭配编号，请只粘贴一份搭配清单");
  if (!unique.length) throw new Error("没有找到搭配编号，请粘贴完整的搭配清单或 HM 搭配编号");
  return decodeConfigWithMigration(unique[0]);
}
