import { availabilityThresholdMaxMinutes, taskSortieType } from "@groundops/contracts";
import { z } from "zod";

export const coordinateSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

export const stopSchema = z.object({
  label: z.string(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  waitMinutes: z.number().int().nonnegative(),
  passenger: z.boolean(),
});

export const tariffSchema = z.object({
  flagCents: z.number().int().nonnegative(),
  perMileCents: z.number().int().nonnegative(),
  perWaitMinuteCents: z.number().int().nonnegative(),
});

export const availabilitySettingsSchema = z.object({
  thresholdMinutes: z.number().int().min(0).max(availabilityThresholdMaxMinutes),
  autoSetUnavailable: z.boolean(),
  autoSetAvailable: z.boolean(),
  geofence: z.array(coordinateSchema).refine((ring) => ring.length === 0 || ring.length >= 3),
});

const realtimeBase = {
  id: z.uuid(),
  userId: z.uuid(),
  recordedAt: z.string().min(1),
};

const locationFixSchema = coordinateSchema.extend({
  accuracyMeters: z.number().nullable(),
  observedAt: z.string(),
});

const meterReadingSchema = z.object({
  sortieId: z.string(),
  milesTraveled: z.number(),
  waitSeconds: z.number(),
  totalCents: z.number(),
  estimateCents: z.number(),
  remainingMeters: z.number(),
  overviewPath: z.array(coordinateSchema),
  updatedAt: z.string(),
});

const sortieStopSchema = stopSchema.extend({
  actualArrivedAt: z.string().nullable(),
  actualDepartedAt: z.string().nullable(),
});

const sortieSchema = z.object({
  id: z.string(),
  type: z.literal(taskSortieType),
  label: z.string(),
  arrivalAt: z.string(),
  arrivalAuthored: z.boolean(),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  actualStart: z.string().nullable(),
  actualEnd: z.string().nullable(),
  departureAddress: z.string(),
  passengerName: z.string().nullable(),
  passengerPhone: z.string().nullable(),
  stops: z.array(sortieStopSchema),
});

/** The envelope shape `publishRealtime` builds. The gateway forwards the original bytes when this parses. */
export const realtimeEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({ ...realtimeBase, type: z.literal("sortie.updated"), sortie: sortieSchema }),
  z.object({ ...realtimeBase, type: z.literal("location.updated"), location: locationFixSchema }),
  z.object({ ...realtimeBase, type: z.literal("meter.updated"), meter: meterReadingSchema }),
  z.object({ ...realtimeBase, type: z.literal("meter.cleared") }),
  z.object({
    ...realtimeBase,
    type: z.literal("availability.updated"),
    available: z.boolean(),
    current: z.boolean(),
  }),
]);
