import type { GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";

const alphabet = "23456789CFGHJMPQRVWX";
const separatorPosition = 8;
const pairDigits = 10;
const pairResolution = [20, 1, 0.05, 0.0025, 0.000125];
const gridRows = 5;
const gridColumns = 4;

/**
 * A typed coordinate or plus code, ready to use as a place.
 * Short plus codes are recovered from `bias` when the query has no locality.
 */
export function parsePlaceQuery(query: string, bias?: GeoCoordinate | null): PlaceSuggestion | null {
  const text = query.trim();
  if (text.length === 0) {
    return null;
  }
  return (
    fromGeoJson(text) ??
    fromWkt(text) ??
    fromGeoUri(text) ??
    fromMapUrl(text, bias ?? null) ??
    fromPlusCode(text, bias ?? null) ??
    fromLabeledPair(text) ??
    fromDegrees(text) ??
    fromDecimalPair(text)
  );
}

function fromGeoJson(text: string): PlaceSuggestion | null {
  if (!text.startsWith("{")) {
    return null;
  }
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object") {
      return null;
    }
    const point = body as { type?: unknown; coordinates?: unknown };
    if (point.type !== "Point" || !Array.isArray(point.coordinates)) {
      return null;
    }
    const longitude = point.coordinates[0];
    const latitude = point.coordinates[1];
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return null;
    }
    return coordinatePlace(latitude, longitude);
  } catch {
    return null;
  }
}

function fromWkt(text: string): PlaceSuggestion | null {
  const body = text.trim().replace(/^SRID\s*=\s*\d+\s*;\s*/i, "");
  const match = /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(body);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return coordinatePlace(Number(match[2]), Number(match[1]));
}

function fromGeoUri(text: string): PlaceSuggestion | null {
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,-?\d+(?:\.\d+)?)?(?:\?.*)?$/i.exec(text);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return coordinatePlace(Number(match[1]), Number(match[2]));
}

function fromMapUrl(text: string, bias: GeoCoordinate | null): PlaceSuggestion | null {
  if (!/^https?:\/\//i.test(text) && !/^www\./i.test(text)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(text.startsWith("www.") ? `https://${text}` : text);
  } catch {
    return null;
  }
  let href = url.href;
  try {
    href = decodeURIComponent(url.href);
  } catch {
    href = url.href;
  }
  const embedded = plusCodeIn(href);
  if (embedded) {
    const coded = fromPlusCode(embedded, bias);
    if (coded) {
      return coded;
    }
  }
  const bang = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(href);
  if (bang?.[1] && bang[2]) {
    return coordinatePlace(Number(bang[1]), Number(bang[2]));
  }
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(href);
  if (at?.[1] && at[2]) {
    return coordinatePlace(Number(at[1]), Number(at[2]));
  }
  const hash = /map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
  if (hash?.[1] && hash[2]) {
    return coordinatePlace(Number(hash[1]), Number(hash[2]));
  }
  const latitude = url.searchParams.get("mlat");
  const longitude = url.searchParams.get("mlon");
  if (latitude && longitude) {
    return coordinatePlace(Number(latitude), Number(longitude));
  }
  const query =
    url.searchParams.get("q") ??
    url.searchParams.get("query") ??
    url.searchParams.get("ll") ??
    url.searchParams.get("daddr") ??
    url.searchParams.get("destination");
  if (!query) {
    const segment = url.pathname.split("/").find((part) => part.includes(",") || part.includes("+"));
    return segment ? (fromPlusCode(segment, bias) ?? fromDecimalPair(segment.replaceAll("+", " "))) : null;
  }
  const located = query.replace(/^loc:/i, "");
  return fromPlusCode(located, bias) ?? fromDecimalPair(located) ?? fromDegrees(located);
}

function fromPlusCode(text: string, bias: GeoCoordinate | null): PlaceSuggestion | null {
  const match = /^\s*([23456789CFGHJMPQRVWX0]{0,8}\+[23456789CFGHJMPQRVWX]{0,8})\s*(?:,\s*|\s+)?(.*)$/i.exec(
    text.trim(),
  );
  if (!match?.[1] || !isPlusCode(match[1])) {
    return null;
  }
  const code = match[1].toUpperCase();
  const locality = match[2]?.trim() ?? "";
  const full = isFullPlusCode(code);
  if (!full && locality.length > 0) {
    return null;
  }
  const resolved = full ? code : bias ? recoverPlusCode(code, bias.latitude, bias.longitude) : null;
  if (!resolved) {
    return null;
  }
  const area = decodePlusCode(resolved);
  const place = coordinatePlace(area.latitudeCenter, area.longitudeCenter);
  if (!place) {
    return null;
  }
  return { ...place, name: resolved, label: resolved, detail: place.label };
}

function fromLabeledPair(text: string): PlaceSuggestion | null {
  const pattern = /\b(lat(?:itude)?|lon(?:gitude)?|lng|long)\b\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/gi;
  let latitude: number | null = null;
  let longitude: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const label = match[1]?.toLowerCase();
    const value = match[2];
    if (!label || !value) {
      continue;
    }
    const number = Number(value.replace(",", "."));
    if (label.startsWith("lat")) {
      latitude = number;
    } else {
      longitude = number;
    }
  }
  if (latitude === null || longitude === null) {
    return null;
  }
  return coordinatePlace(latitude, longitude);
}

function fromDegrees(text: string): PlaceSuggestion | null {
  const normalized = text
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/[\u2032\u2019\u2018]/g, "'")
    .replace(/[\u2033\u201d\u201c]/g, '"');
  return fromSpacedSexagesimal(normalized) ?? fromMarkedDegrees(normalized);
}

function fromSpacedSexagesimal(text: string): PlaceSuggestion | null {
  const match =
    /^(-?\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)(?:\s+(\d+(?:[.,]\d+)?))?\s*([NS])[\s,]+(-?\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)(?:\s+(\d+(?:[.,]\d+)?))?\s*([EW])$/i.exec(
      text.trim(),
    );
  if (!match) {
    return null;
  }
  const latitude = sexagesimal(match[1], match[2], match[3], match[4]);
  const longitude = sexagesimal(match[5], match[6], match[7], match[8]);
  if (latitude === null || longitude === null) {
    return null;
  }
  return coordinatePlace(latitude, longitude);
}

function fromMarkedDegrees(text: string): PlaceSuggestion | null {
  if (!/[°º˚]/.test(text) && !/\d\s*[NSEW]\b/i.test(text) && !/\b[NSEW]\s*-?\d/i.test(text) && !/\d[dms'′″"]/i.test(text)) {
    return null;
  }
  const number = "-?\\d+(?:[.,]\\d+)?";
  const minutes = `(?:\\s*(?!${number}\\s*[°º˚d])(${number})(?:\\s*[′'m])?)?`;
  const seconds = `(?:\\s*(${number})\\s*[″"s])?`;
  const pattern = new RegExp(
    `(?:([NSEW])\\s*(${number})(?:\\s*[°º˚d])?${minutes}${seconds}|` +
      `(${number})(?:\\s*[°º˚d])?${minutes}${seconds}\\s*([NSEW])?)`,
    "gi",
  );
  const parts: Axis[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const gap = text.slice(cursor, match.index ?? cursor).replace(/[\s,;/]+/g, "");
    if (gap.length > 0) {
      return null;
    }
    const axis = axisFromMatch(match);
    if (!axis) {
      return null;
    }
    parts.push(axis);
    cursor = match.index + match[0].length;
  }
  if (text.slice(cursor).replace(/[\s,;/]+/g, "").length > 0 || parts.length !== 2) {
    return null;
  }
  const first = parts[0];
  const second = parts[1];
  if (!first || !second) {
    return null;
  }
  return assignAxes(first, second);
}

function fromDecimalPair(text: string): PlaceSuggestion | null {
  const european = /^(-?\d+,\d+)\s*;\s*(-?\d+,\d+)(?:\s*;\s*-?\d+(?:[.,]\d+)?)?$/.exec(text.trim());
  if (european?.[1] && european[2]) {
    return orderedPair(Number(european[1].replace(",", ".")), Number(european[2].replace(",", ".")));
  }
  const match =
    /^\(?\[?\s*(-?\d+(?:\.\d+)?)\s*[,/\s]\s*(-?\d+(?:\.\d+)?)(?:\s*[,/\s]\s*-?\d+(?:\.\d+)?)?\s*\]?\)?$/.exec(
      text.trim(),
    );
  if (match?.[1] && match[2]) {
    return orderedPair(Number(match[1]), Number(match[2]));
  }
  const trailing =
    /^(-?\d+\.\d+)\s*[,/\s]\s*(-?\d+\.\d+)\b(?:\s*[,;]\s*|\s+)(?=[A-Za-z(])/.exec(text.trim());
  if (!trailing?.[1] || !trailing[2]) {
    return null;
  }
  return orderedPair(Number(trailing[1]), Number(trailing[2]));
}

/** A pair with no hemisphere is latitude first, unless only the first value is outside the latitude range. */
function orderedPair(first: number, second: number): PlaceSuggestion | null {
  if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
    return coordinatePlace(second, first);
  }
  return coordinatePlace(first, second);
}

type Axis = { value: number; axis: "lat" | "lng" | null };

function axisFromMatch(match: RegExpMatchArray): Axis | null {
  const leading = Boolean(match[1]);
  const value = sexagesimal(
    leading ? match[2] : match[5],
    leading ? match[3] : match[6],
    leading ? match[4] : match[7],
    leading ? match[1] : match[8],
  );
  if (value === null) {
    return null;
  }
  const hemisphere = (leading ? match[1] : match[8])?.toUpperCase() ?? "";
  const axis = hemisphere === "N" || hemisphere === "S" ? "lat" : hemisphere === "E" || hemisphere === "W" ? "lng" : null;
  return { value, axis };
}

function sexagesimal(
  degreesText: string | undefined,
  minutesText: string | undefined,
  secondsText: string | undefined,
  hemisphere: string | undefined,
): number | null {
  const degrees = signed(degreesText);
  const minutes = minutesText ? signed(minutesText) : 0;
  const seconds = secondsText ? signed(secondsText) : 0;
  if (degrees === null || minutes === null || seconds === null) {
    return null;
  }
  if (minutes < 0 || seconds < 0 || minutes >= 60 || seconds >= 60) {
    return null;
  }
  const side = hemisphere?.toUpperCase() ?? "";
  const sign = side === "S" || side === "W" ? -1 : 1;
  const magnitude = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  return side ? sign * magnitude : degrees < 0 ? -magnitude : magnitude;
}

function assignAxes(first: Axis, second: Axis): PlaceSuggestion | null {
  if (first.axis && second.axis && first.axis === second.axis) {
    return null;
  }
  let latitude = first.value;
  let longitude = second.value;
  if (first.axis === "lng" || second.axis === "lat") {
    latitude = second.value;
    longitude = first.value;
  } else if (!first.axis && !second.axis && Math.abs(first.value) > 90 && Math.abs(second.value) <= 90) {
    latitude = second.value;
    longitude = first.value;
  }
  return coordinatePlace(latitude, longitude);
}

function coordinatePlace(latitude: number, longitude: number): PlaceSuggestion | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90) {
    return null;
  }
  let wrapped = longitude;
  while (wrapped > 180) {
    wrapped -= 360;
  }
  while (wrapped < -180) {
    wrapped += 360;
  }
  if (Math.abs(longitude) > 360) {
    return null;
  }
  const label = `${trimCoordinate(latitude)}, ${trimCoordinate(wrapped)}`;
  return { name: label, label, detail: "", latitude, longitude: wrapped };
}

function trimCoordinate(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

function signed(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const number = Number(value.replace(",", ".").replace("−", "-"));
  return Number.isFinite(number) ? number : null;
}

type PlusArea = {
  latitudeCenter: number;
  longitudeCenter: number;
};

function decodePlusCode(code: string): PlusArea {
  const digits = significantDigits(code);
  let latitude = -90;
  let longitude = -180;
  let latitudeSize = 20;
  let longitudeSize = 20;
  let index = 0;
  while (index < digits.length && index < pairDigits) {
    latitudeSize = pairResolution[index / 2] ?? latitudeSize;
    longitudeSize = latitudeSize;
    latitude += alphabet.indexOf(digits.charAt(index)) * latitudeSize;
    longitude += alphabet.indexOf(digits.charAt(index + 1)) * longitudeSize;
    index += 2;
  }
  while (index < digits.length) {
    latitudeSize /= gridRows;
    longitudeSize /= gridColumns;
    const value = alphabet.indexOf(digits.charAt(index));
    const row = Math.floor(value / gridColumns);
    const column = value % gridColumns;
    latitude += row * latitudeSize;
    longitude += column * longitudeSize;
    index += 1;
  }
  return {
    latitudeCenter: latitude + latitudeSize / 2,
    longitudeCenter: longitude + longitudeSize / 2,
  };
}

function recoverPlusCode(shortCode: string, latitude: number, longitude: number): string {
  const padding = separatorPosition - shortCode.indexOf("+");
  const resolution = 20 ** (2 - padding / 2);
  const half = resolution / 2;
  const referenceLatitude = Math.min(90, Math.max(-90, latitude));
  let referenceLongitude = longitude;
  while (referenceLongitude < -180) {
    referenceLongitude += 360;
  }
  while (referenceLongitude >= 180) {
    referenceLongitude -= 360;
  }
  const area = decodePlusCode(encodePlusCode(referenceLatitude, referenceLongitude).slice(0, padding) + shortCode);
  let latitudeCenter = area.latitudeCenter;
  let longitudeCenter = area.longitudeCenter;
  if (referenceLatitude + half < latitudeCenter && latitudeCenter - resolution >= -90) {
    latitudeCenter -= resolution;
  } else if (referenceLatitude - half > latitudeCenter && latitudeCenter + resolution <= 90) {
    latitudeCenter += resolution;
  }
  if (referenceLongitude + half < longitudeCenter) {
    longitudeCenter -= resolution;
  } else if (referenceLongitude - half > longitudeCenter) {
    longitudeCenter += resolution;
  }
  const length = padding + shortCode.replace("+", "").length;
  return encodePlusCode(latitudeCenter, longitudeCenter, length);
}

const pairPrecision = 20 ** 3;
const finalLatitudePrecision = pairPrecision * gridRows ** (15 - pairDigits);
const finalLongitudePrecision = pairPrecision * gridColumns ** (15 - pairDigits);

function encodePlusCode(latitude: number, longitude: number, codeLength = pairDigits): string {
  let [latitudeInt, longitudeInt] = locationToIntegers(latitude, longitude);
  const code = new Array<string>(16);
  code[separatorPosition] = "+";
  if (codeLength > pairDigits) {
    for (let index = 15 - pairDigits; index >= 1; index -= 1) {
      const row = latitudeInt % gridRows;
      const column = longitudeInt % gridColumns;
      code[separatorPosition + 2 + index] = alphabet.charAt(row * gridColumns + column);
      latitudeInt = Math.floor(latitudeInt / gridRows);
      longitudeInt = Math.floor(longitudeInt / gridColumns);
    }
  } else {
    latitudeInt = Math.floor(latitudeInt / gridRows ** (15 - pairDigits));
    longitudeInt = Math.floor(longitudeInt / gridColumns ** (15 - pairDigits));
  }
  code[separatorPosition + 1] = alphabet.charAt(latitudeInt % alphabet.length);
  code[separatorPosition + 2] = alphabet.charAt(longitudeInt % alphabet.length);
  latitudeInt = Math.floor(latitudeInt / alphabet.length);
  longitudeInt = Math.floor(longitudeInt / alphabet.length);
  for (let index = pairDigits / 2 + 1; index >= 0; index -= 2) {
    code[index] = alphabet.charAt(latitudeInt % alphabet.length);
    code[index + 1] = alphabet.charAt(longitudeInt % alphabet.length);
    latitudeInt = Math.floor(latitudeInt / alphabet.length);
    longitudeInt = Math.floor(longitudeInt / alphabet.length);
  }
  if (codeLength >= separatorPosition) {
    return code.slice(0, codeLength + 1).join("");
  }
  return `${code.slice(0, codeLength).join("")}${"0".repeat(separatorPosition - codeLength)}+`;
}

function locationToIntegers(latitude: number, longitude: number): [number, number] {
  let latitudeInt = Math.floor(latitude * finalLatitudePrecision) + 90 * finalLatitudePrecision;
  const latitudeLimit = 2 * 90 * finalLatitudePrecision;
  if (latitudeInt < 0) {
    latitudeInt = 0;
  } else if (latitudeInt >= latitudeLimit) {
    latitudeInt = latitudeLimit - 1;
  }
  let longitudeInt = Math.floor(longitude * finalLongitudePrecision) + 180 * finalLongitudePrecision;
  const longitudeLimit = 2 * 180 * finalLongitudePrecision;
  if (longitudeInt < 0) {
    longitudeInt = (longitudeInt % longitudeLimit) + longitudeLimit;
  } else if (longitudeInt >= longitudeLimit) {
    longitudeInt = longitudeInt % longitudeLimit;
  }
  return [latitudeInt, longitudeInt];
}

function isPlusCode(code: string): boolean {
  const upper = code.toUpperCase();
  const separator = upper.indexOf("+");
  if (separator < 0 || separator !== upper.lastIndexOf("+") || separator > separatorPosition || separator % 2 === 1) {
    return false;
  }
  let front = upper.slice(0, separator);
  const rear = upper.slice(separator + 1);
  const padding = front.indexOf("0");
  if (padding >= 0) {
    if (padding === 0 || padding % 2 === 1 || rear.length > 0 || !/^0+$/.test(front.slice(padding))) {
      return false;
    }
    front = front.slice(0, padding);
  }
  if (!alphabetOnly(front) || !alphabetOnly(rear)) {
    return false;
  }
  const digits = separator === separatorPosition ? front.length + rear.length : separatorPosition + rear.length;
  if (digits < 2 || (digits < pairDigits && digits % 2 === 1)) {
    return false;
  }
  if (separator === separatorPosition && front.length > 0 && alphabet.indexOf(front.charAt(0)) > 8) {
    return false;
  }
  return true;
}

function isFullPlusCode(code: string): boolean {
  return code.indexOf("+") === separatorPosition;
}

function significantDigits(code: string): string {
  const upper = code.toUpperCase().replace("+", "");
  const padding = upper.indexOf("0");
  return padding >= 0 ? upper.slice(0, padding) : upper;
}

function alphabetOnly(text: string): boolean {
  for (const character of text) {
    if (!alphabet.includes(character)) {
      return false;
    }
  }
  return true;
}

function plusCodeIn(text: string): string | null {
  return /([23456789CFGHJMPQRVWX0]{2,8}\+[23456789CFGHJMPQRVWX]{2,8})/i.exec(text)?.[1] ?? null;
}
