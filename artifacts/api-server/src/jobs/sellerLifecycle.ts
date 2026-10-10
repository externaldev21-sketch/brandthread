/** Seller lifecycle jobs: activation nudges (hourly) and the Monday summary (hourly check). */
import { startSellerActivationNudgesJob } from "./sellerActivationNudges";
import { startSellerWeeklySummaryJob } from "./sellerWeeklySummary";

export function startSellerLifecycleJobs(): void {
  startSellerActivationNudgesJob();
  startSellerWeeklySummaryJob();
}
