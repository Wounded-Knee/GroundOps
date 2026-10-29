import { useCallback, useEffect, useRef } from "react";
import type { ReplaceMeterReadingRequest } from "@groundops/contracts";
import { replaceMeterReading } from "./calendarClient";
import { reportDelayMs } from "./liveActivity";

export function useMeterReporter(apiUrl: string, token: string, onUnauthorized: () => void): {
  queueMeterReport: (report: ReplaceMeterReadingRequest, immediate: boolean) => void;
  resetMeterReporter: () => void;
} {
  const tokenRef = useRef(token);
  const onUnauthorizedRef = useRef(onUnauthorized);
  tokenRef.current = token;
  onUnauthorizedRef.current = onUnauthorized;
  const pendingRef = useRef<ReplaceMeterReadingRequest | null>(null);
  const sentAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushMeterReport = useCallback(async () => {
    const report = pendingRef.current;
    pendingRef.current = null;
    if (!report) {
      return;
    }
    sentAtRef.current = Date.now();
    const result = await replaceMeterReading(apiUrl, tokenRef.current, report);
    if (result === "unauthorized") {
      onUnauthorizedRef.current();
    }
  }, [apiUrl]);

  const queueMeterReport = useCallback(
    (report: ReplaceMeterReadingRequest, immediate: boolean) => {
      const previous = pendingRef.current;
      pendingRef.current = {
        ...report,
        ...(report.overviewPath === undefined && previous?.overviewPath ? { overviewPath: previous.overviewPath } : {}),
      };
      const delay = reportDelayMs(sentAtRef.current, Date.now(), immediate);
      if (timerRef.current) {
        if (!immediate) {
          return;
        }
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (delay === 0) {
        void flushMeterReport();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushMeterReport();
      }, delay);
    },
    [flushMeterReport],
  );

  const resetMeterReporter = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    sentAtRef.current = null;
  }, []);

  useEffect(() => resetMeterReporter, [resetMeterReporter]);

  return { queueMeterReport, resetMeterReporter };
}
