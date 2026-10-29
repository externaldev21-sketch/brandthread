import { describe, expect, it } from "vitest";
import { THREAD_CASH_REWARD_SOURCES } from "../revenue";
import { REWARD_SOURCES } from "../../threadCash/earnGate";

describe("admin Thread Cash reward sources", () => {
  it("covers every platform-funded reward the earn gate budgets (admin adjustments are counted separately)", () => {
    const budgeted = REWARD_SOURCES.filter((s) => s !== "admin_adjustment");
    expect([...THREAD_CASH_REWARD_SOURCES].sort()).toEqual([...budgeted].sort());
  });
});
