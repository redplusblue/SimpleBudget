import { describe, expect, it } from "vitest";
import { moveItem } from "@/lib/reorder";

const ids = (xs: Array<{ id: number }>) => xs.map((x) => x.id);
const list = [1, 2, 3, 4].map((id) => ({ id }));

describe("moveItem", () => {
  it("moves before and after a target", () => {
    expect(ids(moveItem(list, 4, 1, "before"))).toEqual([4, 1, 2, 3]);
    expect(ids(moveItem(list, 1, 4, "after"))).toEqual([2, 3, 4, 1]);
    expect(ids(moveItem(list, 1, 3, "before"))).toEqual([2, 1, 3, 4]);
    expect(ids(moveItem(list, 3, 2, "after"))).toEqual([1, 2, 3, 4]);
    expect(ids(moveItem(list, 2, 3, "after"))).toEqual([1, 3, 2, 4]);
  });
  it("ignores no-ops and unknown ids", () => {
    expect(moveItem(list, 2, 2, "before")).toBe(list);
    expect(moveItem(list, 9, 2, "before")).toBe(list);
    expect(moveItem(list, 2, 9, "before")).toBe(list);
  });
  it("doesn't mutate its input", () => {
    moveItem(list, 4, 1, "before");
    expect(ids(list)).toEqual([1, 2, 3, 4]);
  });
});
