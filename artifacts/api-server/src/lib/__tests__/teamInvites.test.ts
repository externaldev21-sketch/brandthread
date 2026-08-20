import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetTeamInviteReminderTracking,
  sendTeamInviteEmail,
  teamInviteReminderIdempotencyKey,
} from "../teamInvites";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("team invite emails", () => {
  it("uses a supplied Resend idempotency key for reminder retries", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const idempotencyKey = teamInviteReminderIdempotencyKey(
      "invite-123",
      "current-token",
    );
    const sent = await sendTeamInviteEmail(
      "member@example.com",
      "Brandthread Studio",
      "staff",
      "https://example.com/team-invite?token=current-token",
      { reminder: true, idempotencyKey },
    );

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": idempotencyKey }),
      }),
    );
    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.html).toContain("expires in approximately 24 hours");
    expect(body.html).toContain("current-token");
  });

  it("clears successful-send and delivery-lease state for a renewed link", () => {
    expect(resetTeamInviteReminderTracking()).toEqual({
      reminderSentAt: null,
      reminderClaimedAt: null,
    });
  });
});