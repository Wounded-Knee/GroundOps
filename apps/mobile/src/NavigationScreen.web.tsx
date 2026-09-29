import type { MeterDisplay } from "./MeterStrip";
import type { SortieGuideCommand } from "./sortieGuide";

export type { SortieGuideCommand } from "./sortieGuide";

export function NavigationScreen(_props: {
  token: string;
  onUnauthorized: () => void;
  sortieGuide?: SortieGuideCommand | null;
  onSortieGuideConsumed?: () => void;
  onMeterReading?: (reading: MeterDisplay | null) => void;
  onMeterEnded?: () => void;
}): null {
  return null;
}
