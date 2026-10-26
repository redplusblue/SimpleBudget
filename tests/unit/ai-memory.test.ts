import { describe, expect, it } from "vitest";
import {
  addMemory,
  deleteMemory,
  listMemories,
  MAX_MEMORIES,
  MemoryError,
  memoryPromptBlock,
  MEMORY_PROMPT_CHARS,
  updateMemory,
} from "@/lib/ai/memory";
import { freshDb } from "../helpers/db";

describe("memories", () => {
  it("adds, edits, disables and deletes", () => {
    const db = freshDb();
    const m = addMemory(db, "  Rent is paid to Acme  ", "user", 10);
    expect(m).toMatchObject({ text: "Rent is paid to Acme", source: "user", enabled: true });
    expect(updateMemory(db, m.id, { text: "Rent goes to Acme Realty", enabled: false })).toMatchObject({
      text: "Rent goes to Acme Realty",
      enabled: false,
    });
    deleteMemory(db, m.id);
    expect(listMemories(db)).toEqual([]);
  });

  it("validates length, count and ids", () => {
    const db = freshDb();
    expect(() => addMemory(db, "hi", "user")).toThrow(MemoryError);
    expect(() => addMemory(db, "x".repeat(301), "user")).toThrow(/under 300/);
    for (let i = 0; i < MAX_MEMORIES; i++) addMemory(db, `fact number ${i}`, "user", i);
    expect(() => addMemory(db, "one too many", "user")).toThrow(/up to 50/);
    expect(() => updateMemory(db, 9999, { enabled: true })).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => deleteMemory(db, 9999)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => updateMemory(db, 1, {})).toThrow(/Nothing to change/);
  });

  it("builds a prompt block from enabled memories, oldest first, within the cap", () => {
    const db = freshDb();
    expect(memoryPromptBlock(db)).toBe("");
    addMemory(db, "First fact", "user", 1);
    const off = addMemory(db, "Disabled fact", "user", 2);
    updateMemory(db, off.id, { enabled: false });
    addMemory(db, "Second fact", "assistant", 3);
    expect(memoryPromptBlock(db)).toBe("What the owner has told you (always true):\n- First fact\n- Second fact");

    const big = freshDb();
    for (let i = 0; i < 10; i++) addMemory(big, `${i}`.padEnd(290, "x"), "user", i);
    const block = memoryPromptBlock(big);
    expect(block.length).toBeLessThanOrEqual(MEMORY_PROMPT_CHARS + 60);
    expect(block).toContain("- 0xxx");
    expect(block).not.toContain("- 9xxx"); // newest dropped
  });
});
