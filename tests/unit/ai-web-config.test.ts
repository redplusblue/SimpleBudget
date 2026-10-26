import { describe, expect, it } from "vitest";
import { AiConfigError, getAiConfig, updateAiConfig } from "@/lib/llm/config";
import { isOpenRouter } from "@/lib/llm/models";
import { freshDb } from "../helpers/db";

describe("web research setting", () => {
  it("is off by default and only OpenRouter can turn it on", () => {
    const db = freshDb();
    expect(getAiConfig(db).webSearch).toBe(false);
    expect(getAiConfig(db).profile).toEqual({ country: "US" });
    updateAiConfig(db, { baseUrl: "http://localhost:11434/v1", model: "m" });
    expect(() => updateAiConfig(db, { webSearch: true })).toThrow(new AiConfigError("Web research needs OpenRouter."));
    expect(getAiConfig(db).webSearch).toBe(false);
    expect(updateAiConfig(db, { baseUrl: "https://openrouter.ai/api/v1", webSearch: true }).webSearch).toBe(true);
  });

  it("stops being effective when the server is no longer OpenRouter", () => {
    const db = freshDb();
    updateAiConfig(db, { baseUrl: "https://openrouter.ai/api/v1", model: "m", webSearch: true });
    expect(getAiConfig(db).webSearch).toBe(true);
    updateAiConfig(db, { baseUrl: "http://localhost:3000/api" });
    expect(getAiConfig(db).webSearch).toBe(false);
  });

  it("recognizes OpenRouter hosts only", () => {
    expect(isOpenRouter("https://openrouter.ai/api/v1")).toBe(true);
    expect(isOpenRouter("https://eu.openrouter.ai/api/v1")).toBe(true);
    expect(isOpenRouter("https://openrouter.ai.evil.example/v1")).toBe(false);
    expect(isOpenRouter("https://notopenrouter.ai/v1")).toBe(false);
    expect(isOpenRouter("nonsense")).toBe(false);
  });

  it("stores a generic profile and resets it", () => {
    const db = freshDb();
    expect(updateAiConfig(db, { profile: { ageRange: "30-39", country: "Canada", householdSize: 3 } }).profile).toEqual(
      {
        ageRange: "30-39",
        country: "Canada",
        householdSize: 3,
      },
    );
    expect(() => updateAiConfig(db, { profile: { ageRange: "12-17" as never, country: "US" } })).toThrow();
    expect(updateAiConfig(db, { profile: null }).profile).toEqual({ country: "US" });
  });
});
