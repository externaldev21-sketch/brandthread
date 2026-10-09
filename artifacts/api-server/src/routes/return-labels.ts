/**
 * Prepaid return labels.
 *
 * POST /api/return-labels/:returnId  — seller buys the cheapest prepaid label for a return
 *      body: { returnAddress: { name, street1, street2?, city, state, zip, country, phone? },
 *              parcel: { length, width, height, weight } }   (inches / pounds)
 *      Approves the return and holds the refund until the carrier first scans the label.
 *
 * The buyer reads the label from GET /api/returns/:id (returnLabelUrl, returnTrackingNumber, ...).
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "@workspace/api-zod";
import { addressInput, bodyObject, idParams, parcelDimension, validateInput } from "../lib/commerceValidation";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { parcelInputError } from "../lib/parcelSuggestion";
import { buyReturnLabel, ReturnLabelError } from "../lib/returnLabels";

const router = Router();
router.use(requireAuth);
router.use(teamContext());

function addressError(value: any): string | null {
  if (!value || typeof value !== "object") return "returnAddress is required";
  for (const key of ["name", "street1", "city", "state", "zip", "country"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) return `returnAddress.${key} is required`;
  }
  return null;
}

// Shape/size guards; addressError / parcelInputError keep the required-field
// and range rules (and their messages).
const returnLabelBody = bodyObject({
  returnAddress: addressInput.nullish(),
  parcel: z.object({
    length: parcelDimension.optional(),
    width: parcelDimension.optional(),
    height: parcelDimension.optional(),
    weight: parcelDimension.optional(),
  }).passthrough().nullish(),
});

router.post("/:returnId", requireRole("staff"), validateInput({ params: idParams("returnId"), body: returnLabelBody }), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const addrProblem = addressError(req.body?.returnAddress);
  if (addrProblem) return void res.status(400).json({ error: addrProblem });
  const parcelProblem = parcelInputError(req.body?.parcel ?? {});
  if (parcelProblem) return void res.status(400).json({ error: parcelProblem });
  try {
    const { label, duplicate } = await buyReturnLabel({
      returnId: req.params.returnId,
      sellerId,
      returnAddress: req.body.returnAddress,
      parcel: req.body.parcel,
    });
    res.status(duplicate ? 200 : 201).json({
      duplicate,
      label: {
        id: label.id, carrier: label.carrier, service: label.service, trackingNumber: label.trackingNumber,
        labelUrl: label.labelUrl, priceCents: label.priceCents, status: label.status,
      },
    });
  } catch (err: any) {
    if (err instanceof ReturnLabelError) return void res.status(err.status).json({ error: err.message, code: err.code });
    req.log.error({ err, returnId: req.params.returnId }, "Return label purchase failed");
    res.status(502).json({ error: "The return label could not be created" });
  }
});

export default router;
