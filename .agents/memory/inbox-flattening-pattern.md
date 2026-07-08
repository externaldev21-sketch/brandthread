---
    name: Inbox structural flattening pattern
    description: Brandthread's mobile inbox/profile screens follow a card-free, Instagram-referenced flat layout; use this precedent for future screen redesigns.
    ---

    Buyer-facing screens (profile, inbox) were restructured away from bordered/card-based lists into flat, spacing-separated rows matching Instagram's visual language (no card backgrounds/borders on list rows, icon-circle leading elements, trailing badges/dots/icons instead of buttons).

    **Why:** User explicitly requested matching real Instagram screenshots for both profile and inbox; a prior code review flagged card-chrome as inconsistent with the flattening direction set in an earlier session.

    **How to apply:** When redesigning another buyer/seller screen against a screenshot reference, default to flat rows (no card/border wrapper) with icon-circle leading + trailing badge/icon, not bordered cards — this is now the established direction for Brandthread, not a one-off.
    