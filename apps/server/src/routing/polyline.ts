import type { GeoCoordinate } from "@groundops/contracts";

/** Decodes a Google encoded polyline into coordinates. The encoded form does not leave the server. */
export function decodePolyline(encoded: string): GeoCoordinate[] {
  const coordinates: GeoCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const latitudeDelta = readDelta(encoded, index);
    if (!latitudeDelta) {
      break;
    }
    index = latitudeDelta.index;
    latitude += latitudeDelta.delta;

    const longitudeDelta = readDelta(encoded, index);
    if (!longitudeDelta) {
      break;
    }
    index = longitudeDelta.index;
    longitude += longitudeDelta.delta;

    coordinates.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }

  return coordinates;
}

function readDelta(encoded: string, start: number): { delta: number; index: number } | null {
  let result = 0;
  let shift = 0;
  let index = start;
  let byte = 0;

  do {
    if (index >= encoded.length) {
      return null;
    }
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  const delta = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
  return { delta, index };
}
