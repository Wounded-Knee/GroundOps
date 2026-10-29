import { useCallback, useEffect, useRef } from "react";
import type { ReplaceMeterReadingRequest } from "@groundops/contracts";
import { replaceMeterReading } from "./calendarClient";
import { clearMeterOutbox, readMeterOutbox, writeMeterOutbox } from "./locationOutbox";
import { reportDelayMs } from "./liveActivity";

export function useMeterReporter(apiUrl: string, token: string, userId: string, onUnauthorized: () => void): {
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
    await writeMeterOutbox(userId, report);
    const result = await replaceMeterReading(apiUrl, tokenRef.current, report);
    if (result === "unauthorized") {
      onUnauthorizedRef.current();
      return;
    }
    if (typeof result === "object" && pendingRef.current === null) {
      await clearMeterOutbox(userId);
    }
  }, [apiUrl, userId]);

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

  useEffect(() => {
    let cancelled = false;
    void readMeterOutbox(userId).then((stored) => {
      if (!cancelled && stored) {
        queueMeterReport(stored, true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [queueMeterReport, userId]);

  useEffect(() => resetMeterReporter, [resetMeterReporter]);

  return { queueMeterReport, resetMeterReporter };
}
