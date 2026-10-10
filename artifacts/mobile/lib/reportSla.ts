/** 24-hour review promise shown on the admin moderation queue. Pure, no React Native imports. */
export const REPORT_SLA_HOURS = 24;

export interface ReportSla { overdue: boolean; label: string }

/** 24-hour review promise: "Due in 5h" until the deadline, then "Overdue 3h". */
export function reportSla(createdAtIso: string, dueByIso?: string | null, now = Date.now()): ReportSla {
  const due = dueByIso ? new Date(dueByIso).getTime() : new Date(createdAtIso).getTime() + REPORT_SLA_HOURS * 3_600_000;
  const diff = due - now;
  const span = (ms: number) => {
    const mins = Math.max(1, Math.round(Math.abs(ms) / 60_000));
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 >= 30 && mins < 600 ? ' 30m' : ''}`;
  };
  return diff >= 0 ? { overdue: false, label: `Due in ${span(diff)}` } : { overdue: true, label: `Overdue ${span(diff)}` };
}
