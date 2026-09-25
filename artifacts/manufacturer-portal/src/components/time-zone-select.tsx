import { useMemo } from "react";
import { timeZoneOffsetLabel } from "@workspace/manufacturer-flow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function allTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function TimeZoneSelect({ value, onChange, id }: { value: string; onChange: (value: string) => void; id?: string }) {
  const zones = useMemo(() => {
    const list = allTimeZones();
    const withValue = value && !list.includes(value) ? [value, ...list] : list;
    const now = new Date();
    return withValue.map((zone) => ({ zone, label: `${zone.replaceAll("_", " ")} (${timeZoneOffsetLabel(zone, now)})` }));
  }, [value]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-12 bg-secondary/50" data-testid="select-time-zone"><SelectValue placeholder="Choose your time zone" /></SelectTrigger>
      <SelectContent className="max-h-72">
        {zones.map((item) => <SelectItem key={item.zone} value={item.zone}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
