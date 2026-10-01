import type { GeoCoordinate } from "@groundops/contracts";

export type GeofenceCamera = {
  latitude: number;
  longitude: number;
  zoom: number;
};

export function GeofenceEditor(_props: {
  ring: GeoCoordinate[];
  initialCamera?: GeofenceCamera;
  onSave: (ring: GeoCoordinate[] | "invalid") => void;
  onCancel: () => void;
}): null {
  return null;
}
