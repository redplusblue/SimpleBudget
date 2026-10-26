import { describe, expect, it } from "vitest";
import { settings } from "@/db/schema";
import { AiConfigError, findModel, getAiConfig, isAllowedModel, modelFor, updateAiConfig } from "@/lib/llm/config";
import { getLlmFor } from "@/lib/llm";
import { ModelListError, parseModelListJson } from "@/lib/llm/models";
import { freshDb } from "../helpers/db";

describe("parseModelListJson", () => {
  it("accepts strings and objects", () => {
    expect(parseModelListJson('["a/b","c/d"]')).toEqual([{ id: "a/b" }, { id: "c/d" }]);
    expect(parseModelListJson('[{"id":"a/b","label":"Cheap","inputPerMTok":0.1}]')).toEqual([
      { id: "a/b", label: "Cheap", inputPerMTok: 0.1 },
    ]);
  });

  it("rejects bad input with readable messages", () => {
    expect(() => parseModelListJson("nope")).toThrow(/valid JSON/);
    expect(() => parseModelListJson('["a","a"]')).toThrow(/twice/);
    expect(() => parseModelListJson('[""]')).toThrow(/empty/);
    expect(() => parseModelListJson(JSON.stringify(Array.from({ length: 31 }, (_, i) => `m${i}`)))).toThrow(
      /at most 30/,
    );
    expect(() => parseModelListJson('["a"')).toThrow(ModelListError);
  });
});

describe("AI config models", () => {
  it("falls back to the single model", () => {
    const db = freshDb();
    expect(getAiConfig(db).models).toEqual([]);
    updateAiConfig(db, { model: "x/y" });
    expect(getAiConfig(db).models).toEqual([{ id: "x/y" }]);
  });

  it("ignores corrupt stored values", () => {
    const db = freshDb();
    updateAiConfig(db, { model: "x/y" });
    db.insert(settings).values({ key: "ai:models", value: "{{" }).run();
    db.insert(settings).values({ key: "ai:feature_models", value: "[1]" }).run();
    db.insert(settings).values({ key: "ai:monthly_budget_micros", value: "abc" }).run();
    const cfg = getAiConfig(db);
    expect(cfg.models).toEqual([{ id: "x/y" }]);
    expect(cfg.featureModels).toEqual({});
    expect(cfg.monthlyBudgetMicros).toBeNull();
  });

  it("validates feature defaults and the default model against the list", () => {
    const db = freshDb();
    updateAiConfig(db, { model: "a", models: [{ id: "a" }, { id: "b" }] });
    expect(() => updateAiConfig(db, { featureModels: { chat: "zzz" } })).toThrow(AiConfigError);
    expect(() => updateAiConfig(db, { models: [{ id: "b" }] })).toThrow(/default model/);
    const cfg = updateAiConfig(db, { featureModels: { chat: "b" }, monthlyBudgetMicros: 5_000_000 });
    expect(cfg.featureModels).toEqual({ chat: "b" });
    expect(cfg.monthlyBudgetMicros).toBe(5_000_000);
    expect(updateAiConfig(db, { models: null, featureModels: null }).models).toEqual([{ id: "a" }]);
  });

  it("resolves models", () => {
    const db = freshDb();
    updateAiConfig(db, { model: "a" });
    const cfg = getAiConfig(db);
    expect(modelFor(cfg, "rules")).toBe("a");
    expect(isAllowedModel({ ...cfg, models: [] }, "a")).toBe(true);
    expect(isAllowedModel(cfg, "q")).toBe(false);
    expect(findModel(cfg, "a")).toEqual({ id: "a" });
  });
});

describe("getLlmFor", () => {
  const setup = () => {
    const db = freshDb();
    updateAiConfig(db, {
      model: "a",
      baseUrl: "http://localhost:1/v1",
      models: [{ id: "a" }, { id: "b" }],
      featureModels: { trace: "b" },
    });
    return db;
  };

  it("is null when disabled", () => {
    expect(getLlmFor(setup(), "chat")).toBeNull();
  });

  it("uses the feature default, or a requested model from the list", () => {
    const db = setup();
    updateAiConfig(db, { enabled: true });
    expect(getLlmFor(db, "chat")?.model).toBe("a");
    expect(getLlmFor(db, "trace")?.model).toBe("b");
    expect(getLlmFor(db, "chat", "b")?.model).toBe("b");
    expect(() => getLlmFor(db, "chat", "nope")).toThrow(AiConfigError);
  });
});
