import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("public/actions.json", () => {
  const filePath = path.resolve(process.cwd(), "public/actions.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);

  it("has rules array", () => {
    expect(Array.isArray(json.rules)).toBe(true);
    expect(json.rules.length).toBeGreaterThan(0);
  });

  it("contains roll2roll action mappings", () => {
    const apiPaths = new Set(json.rules.map((r: any) => r.apiPath));
    expect(apiPaths.has("/api/actions/round")).toBe(true);
    expect(apiPaths.has("/api/actions/join")).toBe(true);
    expect(apiPaths.has("/api/actions/join-batch")).toBe(true);
    expect(apiPaths.has("/api/actions/claim")).toBe(true);
    expect(apiPaths.has("/api/actions/claim-degen")).toBe(true);
    expect(apiPaths.has("/api/actions/claim-refund")).toBe(true);
  });

  it("uses relative paths in rules", () => {
    for (const rule of json.rules) {
      expect(typeof rule.pathPattern).toBe("string");
      expect(typeof rule.apiPath).toBe("string");
      expect(rule.pathPattern.startsWith("/")).toBe(true);
      expect(rule.apiPath.startsWith("/")).toBe(true);
    }
  });
});
