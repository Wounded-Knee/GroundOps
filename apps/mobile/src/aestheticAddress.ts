/** Place title over the rest of the address. Saved stops only have a single label, split on the first comma. */
export function aestheticAddress(place: { label: string; name: string; detail: string }): {
  title: string;
  subtitle: string;
} {
  const detail = place.detail.trim();
  const name = place.name.trim();
  if (detail.length > 0) {
    return { title: name.length > 0 ? name : place.label.trim(), subtitle: detail };
  }
  const source = place.label.trim().length > 0 ? place.label.trim() : name;
  const comma = source.indexOf(",");
  if (comma <= 0) {
    return { title: source, subtitle: "" };
  }
  const title = source.slice(0, comma).trim();
  const subtitle = source.slice(comma + 1).trim();
  if (title.length === 0 || subtitle.length === 0) {
    return { title: source, subtitle: "" };
  }
  return { title, subtitle };
}
