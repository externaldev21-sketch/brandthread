/** Small formatters shared by the follower-push and giveaway screens. */

/** "today at 3:14 PM" / "tomorrow at 9:00 AM" / "Mar 4 at 9:00 AM" */
export function formatNextSend(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (dayDiff <= 0) return `today at ${time}`;
  if (dayDiff === 1) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2d 4h left" / "3h 10m left" / "Ended" */
export function timeLeft(endIso: string, now: Date = new Date()): string {
  const ms = new Date(endIso).getTime() - now.getTime();
  if (!(ms > 0)) return 'Ended';
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins % 60}m left`;
  return `${Math.max(1, mins)}m left`;
}

export function phaseLabel(phase: string): string {
  switch (phase) {
    case 'live': return 'Live';
    case 'upcoming': return 'Scheduled';
    case 'ended': return 'Ended';
    case 'drawn': return 'Winners drawn';
    case 'cancelled': return 'Cancelled';
    default: return phase;
  }
}
