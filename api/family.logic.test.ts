import { describe, expect, it } from "vitest";
import { calculateProgress, isFirstTenEligible, isPerfectWeekEligible, TASK_CATEGORIES } from "../shared/family";

describe("family task rules", () => {
  it("uses exactly the four approved task categories", () => {
    expect(TASK_CATEGORIES).toEqual(["academic", "household", "hygiene", "organization"]);
  });

  it("calculates a bounded task progress percentage", () => {
    expect(calculateProgress(3, 4)).toBe(75);
    expect(calculateProgress(12, 10)).toBe(100);
    expect(calculateProgress(0, 0)).toBe(0);
  });

  it("requires the agreed completion thresholds before badges are eligible", () => {
    expect(isFirstTenEligible(9)).toBe(false);
    expect(isFirstTenEligible(10)).toBe(true);
    expect(isPerfectWeekEligible({ scheduledTasks: 4, completedOnTime: 4 })).toBe(false);
    expect(isPerfectWeekEligible({ scheduledTasks: 5, completedOnTime: 5 })).toBe(true);
    expect(isPerfectWeekEligible({ scheduledTasks: 5, completedOnTime: 4 })).toBe(false);
  });
});
