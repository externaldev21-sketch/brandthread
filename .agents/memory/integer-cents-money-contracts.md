---
name: Integer-cents money contracts
description: Durable rules for representing and calculating money in Brandthread mobile code.
---

Represent monetary values in domain, API, persistence, and state models as safe integer cents with explicit `*Cents` names. Parse decimal user input with string-based validation, never `parseFloat(value) * 100`. Use integer basis points or an explicit integer rounding policy for percentages and allocations. Format cents only at the UI boundary without converting the amount to a floating-point dollar value.

**Why:** Binary floating-point conversions and mixed dollar/cents contracts caused rounding risk, heuristic scaling, and a fixed-discount double-scaling bug.

**How to apply:** Any new price, discount, tax, shipping, payout, refund, inventory value, quote, or total must enter the system as integer cents. Non-money ratios, progress values, dimensions, and timestamps are outside this rule.