import { describe, expect, it } from "vitest";
import {
  allowListedRedirect,
  buildConnectSteps,
  deadlineIso,
  deriveSetupState,
  requirementShortLabel,
  selectHostedLink,
  shouldNotifyRestricted,
  signConnectState,
  stepForRequirement,
  verifyConnectState,
} from "../connectOnboarding";

const byId = (steps: ReturnType<typeof buildConnectSteps>) => Object.fromEntries(steps.map((s) => [s.id, s]));

describe("stepForRequirement", () => {
  it.each([
    ["external_account", "bank_account"],
    ["individual.ssn_last_4", "tax_info"],
    ["individual.id_number", "tax_info"],
    ["company.tax_id", "tax_info"],
    ["individual.dob.day", "identity"],
    ["individual.verification.document", "identity"],
    ["business_profile.url", "identity"],
    ["tos_acceptance.date", "identity"],
  ])("%s -> %s", (id, step) => {
    expect(stepForRequirement(id)).toBe(step);
  });

  it("gives short labels", () => {
    expect(requirementShortLabel("individual.verification.document")).toBe("Photo ID");
    expect(requirementShortLabel("external_account")).toBe("Bank account details");
  });
});

describe("buildConnectSteps", () => {
  it("marks everything needed before an account exists", () => {
    const steps = buildConnectSteps(null);
    expect(steps.map((s) => s.status)).toEqual(["needed", "needed", "needed"]);
    expect(deriveSetupState(null, steps)).toBe("not_started");
  });

  it("splits currently_due across steps with past-due flags", () => {
    const account = {
      details_submitted: false,
      requirements: {
        currently_due: ["individual.dob.day", "individual.address.line1", "external_account", "individual.ssn_last_4"],
        past_due: ["external_account"],
      },
    };
    const steps = byId(buildConnectSteps(account, { hasBankAccount: false }));
    expect(steps.identity).toMatchObject({ status: "needed", detail: "Date of birth and Home address" });
    expect(steps.bank_account).toMatchObject({ status: "needed", pastDue: true, requirements: ["external_account"] });
    expect(steps.tax_info).toMatchObject({ status: "needed", detail: "Last 4 of SSN" });
    expect(deriveSetupState(account, Object.values(steps))).toBe("in_progress");
  });

  it("reports pending_verification as in_review", () => {
    const account = {
      details_submitted: true,
      requirements: { currently_due: [], pending_verification: ["individual.verification.document"], disabled_reason: "requirements.pending_verification" },
    };
    const steps = buildConnectSteps(account, { hasBankAccount: true });
    expect(byId(steps).identity.status).toBe("in_review");
    expect(byId(steps).bank_account.status).toBe("complete");
    expect(deriveSetupState(account, steps)).toBe("in_review");
  });

  it("is complete when active and nothing is due, and mentions the 1099", () => {
    const account = { details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [] } };
    const steps = buildConnectSteps(account, { hasBankAccount: true });
    expect(steps.every((s) => s.status === "complete")).toBe(true);
    expect(byId(steps).tax_info.detail).toContain("1099");
    expect(deriveSetupState(account, steps)).toBe("complete");
  });

  it("flags a submitted account that lost requirements as restricted", () => {
    const account = {
      details_submitted: true, charges_enabled: true, payouts_enabled: false,
      requirements: { currently_due: ["individual.verification.document"], past_due: ["individual.verification.document"] },
    };
    const steps = buildConnectSteps(account, { hasBankAccount: true });
    expect(byId(steps).identity.pastDue).toBe(true);
    expect(deriveSetupState(account, steps)).toBe("restricted");
  });

  it("surfaces future_requirements without blocking the step", () => {
    const account = {
      details_submitted: true, charges_enabled: true, payouts_enabled: true,
      requirements: { currently_due: [] },
      future_requirements: { currently_due: [], eventually_due: ["individual.verification.document"] },
    };
    const steps = byId(buildConnectSteps(account, { hasBankAccount: true }));
    expect(steps.identity.status).toBe("complete");
    expect(steps.identity.upcoming).toEqual(["individual.verification.document"]);
  });

  it("needs a bank account when submitted but none is attached", () => {
    const steps = byId(buildConnectSteps({ details_submitted: true, requirements: {} }, { hasBankAccount: false }));
    expect(steps.bank_account).toMatchObject({ status: "needed", detail: "Add a payout bank account" });
  });

  it("turns a Stripe rejection into an identity step to redo", () => {
    const steps = byId(buildConnectSteps({ details_submitted: true, requirements: { disabled_reason: "rejected.fraud" } }, { hasBankAccount: true }));
    expect(steps.identity.status).toBe("needed");
  });

  it("converts current_deadline to ISO", () => {
    expect(deadlineIso({ requirements: { current_deadline: 1_800_000_000 } })).toBe("2027-01-15T08:00:00.000Z");
    expect(deadlineIso({ requirements: {} })).toBeNull();
    expect(deadlineIso(null)).toBeNull();
  });
});

describe("selectHostedLink", () => {
  it("uses onboarding until details are submitted", () => {
    expect(selectHostedLink({ details_submitted: false })).toBe("account_onboarding");
  });
  it("uses onboarding when requirements are outstanding on a submitted account", () => {
    expect(selectHostedLink({ details_submitted: true, requirements: { currently_due: ["individual.dob.day"] } })).toBe("account_onboarding");
    expect(selectHostedLink({ details_submitted: true, requirements: { past_due: ["external_account"] } })).toBe("account_onboarding");
    expect(selectHostedLink({ details_submitted: true, requirements: { disabled_reason: "rejected.other" } })).toBe("account_onboarding");
  });
  it("uses the Express dashboard login link once everything is submitted", () => {
    expect(selectHostedLink({ details_submitted: true, requirements: { currently_due: [] } })).toBe("login_link");
    expect(selectHostedLink({ details_submitted: true, requirements: { disabled_reason: "requirements.pending_verification" } })).toBe("login_link");
  });
});

describe("allowListedRedirect", () => {
  const allowed = ["https://brandthread.app"];
  it("accepts https URLs on allow-listed origins", () => {
    expect(allowListedRedirect("https://brandthread.app/x?y=1", allowed)).toBe("https://brandthread.app/x?y=1");
  });
  it.each([
    "https://evil.example/cb",
    "http://brandthread.app/x",
    "https://brandthread.app.evil.example/x",
    "https://user:pw@brandthread.app/x",
    "javascript:alert(1)",
    "brandthread://payout-setup",
    "//brandthread.app/x",
    "not a url",
  ])("rejects %s", (u) => {
    expect(allowListedRedirect(u, allowed)).toBeNull();
  });
  it("rejects non-strings", () => {
    expect(allowListedRedirect(42, allowed)).toBeNull();
    expect(allowListedRedirect(undefined, allowed)).toBeNull();
  });
});

describe("connect state token", () => {
  it("round trips, and rejects tampering, wrong secret and expiry", () => {
    const token = signConnectState("user_1", "s3cret", 1000, 5000);
    expect(verifyConnectState(token, "s3cret", 2000)).toBe("user_1");
    expect(verifyConnectState(token, "other", 2000)).toBeNull();
    expect(verifyConnectState(token, "s3cret", 7000)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ u: "user_2", e: 99999 })).toString("base64url")}.${sig}`;
    expect(verifyConnectState(forged, "s3cret", 2000)).toBeNull();
    expect(verifyConnectState(`${body}`, "s3cret", 2000)).toBeNull();
    expect(verifyConnectState(undefined, "s3cret")).toBeNull();
  });
});

describe("shouldNotifyRestricted", () => {
  it("notifies on the transition into restricted, not on repeats", () => {
    expect(shouldNotifyRestricted("pending", "restricted", [])).toBe(true);
    expect(shouldNotifyRestricted("restricted", "restricted", [])).toBe(false);
  });
  it("notifies when an active account loses capability", () => {
    expect(shouldNotifyRestricted("active", "pending", [])).toBe(true);
  });
  it("notifies when a requirement goes past due on a changed status", () => {
    expect(shouldNotifyRestricted("pending", "pending", ["external_account"])).toBe(false);
    expect(shouldNotifyRestricted("active", "active", ["external_account"])).toBe(false);
    expect(shouldNotifyRestricted("pending", "active", ["x"])).toBe(true);
  });
  it("stays quiet for healthy transitions", () => {
    expect(shouldNotifyRestricted("pending", "active", [])).toBe(false);
    expect(shouldNotifyRestricted(null, "pending", [])).toBe(false);
  });
});
