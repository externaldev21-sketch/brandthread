import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface SellerVacationStatus {
  active: boolean;
  message: string;
  until: Date | null;
}

const DEFAULT_VACATION_MESSAGE =
  "This seller is currently away and is not accepting new purchases or messages.";

export async function getSellerVacationStatus(
  sellerId: string,
  now = new Date(),
): Promise<SellerVacationStatus> {
  const [seller] = await db
    .select({
      vacationMode: users.vacationMode,
      vacationMessage: users.vacationMessage,
      vacationUntil: users.vacationUntil,
    })
    .from(users)
    .where(eq(users.clerkId, sellerId))
    .limit(1);

  if (!seller?.vacationMode) {
    return { active: false, message: "", until: seller?.vacationUntil ?? null };
  }

  if (seller.vacationUntil && seller.vacationUntil.getTime() <= now.getTime()) {
    await db
      .update(users)
      .set({ vacationMode: false, vacationUntil: null, updatedAt: now })
      .where(eq(users.clerkId, sellerId));
    return { active: false, message: "", until: null };
  }

  return {
    active: true,
    message: seller.vacationMessage?.trim() || DEFAULT_VACATION_MESSAGE,
    until: seller.vacationUntil,
  };
}
