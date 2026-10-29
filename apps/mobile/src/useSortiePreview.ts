import type { PlaceSuggestion, SortieStopWrite } from "@groundops/contracts";
import { useEffect, useRef, useState } from "react";
import { previewSortie, scheduleConflictMessage } from "./calendarClient";

type PreviewStop = {
  chosen: PlaceSuggestion | null;
  waitMinutes: number;
  passenger: boolean;
};

export function useSortiePreview(input: {
  apiUrl: string;
  token: string;
  arrival: Date | null;
  sortieId: string | null;
  stops: readonly PreviewStop[];
  onUnauthorized: () => void;
}): string | null {
  const [conflict, setConflict] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const onUnauthorizedRef = useRef(input.onUnauthorized);
  onUnauthorizedRef.current = input.onUnauthorized;
  const { apiUrl, token, arrival, sortieId, stops } = input;

  useEffect(() => {
    const chosen = previewableStops(stops);
    if (chosen.length === 0) {
      previewRequest.current += 1;
      setConflict(null);
      return;
    }
    const requestId = ++previewRequest.current;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await previewSortie(apiUrl, token, {
          label: "",
          arrivalAt: arrival ? arrival.toISOString() : null,
          passengerName: null,
          passengerPhone: null,
          stops: chosen,
          sortieId,
        });
        if (requestId !== previewRequest.current) {
          return;
        }
        if (result === "unauthorized") {
          onUnauthorizedRef.current();
          return;
        }
        if (typeof result === "string") {
          setConflict(null);
          return;
        }
        setConflict(scheduleConflictMessage(result.endangered.map((item) => item.label)));
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [apiUrl, arrival, sortieId, stops, token]);

  return conflict;
}

function previewableStops(drafts: readonly PreviewStop[]): SortieStopWrite[] {
  const stops: SortieStopWrite[] = [];
  for (const draft of drafts) {
    if (!draft.chosen || !Number.isInteger(draft.waitMinutes) || draft.waitMinutes < 0) {
      continue;
    }
    stops.push({
      label: draft.chosen.label,
      latitude: draft.chosen.latitude,
      longitude: draft.chosen.longitude,
      waitMinutes: draft.waitMinutes,
      passenger: draft.passenger,
    });
  }
  return stops;
}
