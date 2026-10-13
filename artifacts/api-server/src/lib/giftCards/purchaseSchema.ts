/**
 * Body of POST /api/gift-cards/purchase. The recipient is reached by email or
 * by text: one of recipientEmail / recipientPhone is required. The phone is
 * normalized to E.164 here (US numbers without +1 are accepted).
 */
import { z } from "@workspace/api-zod";
import { requestPrimitives } from "../../middlewares/validateRequest";
import { toE164 } from "../sms/phone";

const recipientPhone = z.string().trim().max(32).transform((value, ctx) => {
  const e164 = toE164(value);
  if (!e164) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid mobile number." });
    return z.NEVER;
  }
  return e164;
});

export const purchaseSchema = z.object({
  sellerId: requestPrimitives.id,
  amountCents: z.coerce.number().int(),
  recipientEmail: requestPrimitives.email.optional(),
  recipientPhone: recipientPhone.optional(),
  recipientName: z.string().trim().max(80).optional(),
  message: z.string().trim().max(300).optional(),
  forSelf: z.boolean().optional(),
  clientIdempotencyKey: z.string().trim().min(8).max(120),
}).refine((body) => Boolean(body.recipientEmail || body.recipientPhone), {
  message: "Enter the recipient's email or mobile number.",
  path: ["recipientEmail"],
});

export type PurchaseBody = z.infer<typeof purchaseSchema>;
