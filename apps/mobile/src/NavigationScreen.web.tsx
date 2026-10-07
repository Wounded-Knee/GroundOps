import type { Sortie } from "@groundops/contracts";
import type { MutableRefObject } from "react";
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
  onSortieCompleted?: () => void;
  onOnwardDestination?: (sortie: Sortie) => void;
  endGuidanceRef?: MutableRefObject<(() => void) | null>;
  meterArriveRef?: MutableRefObject<(() => void) | null>;
  meterPlusOneRef?: MutableRefObject<(() => void) | null>;
  meterOnwardRef?: MutableRefObject<(() => void) | null>;
  meterCommenceRef?: MutableRefObject<(() => void) | null>;
  applySortieUpdateRef?: MutableRefObject<((sortie: Sortie) => void) | null>;
}): null {
  return null;
}
