/** Guiding and arrived keep the map above other apps. Browse and preview do not. */
export function isActiveNavigation(mode: string): boolean {
  return mode === "guiding" || mode === "arrived";
}

/** Route thickness in the floating window, relative to the full-screen stroke. */
export const floatingRouteScale = 0.45;

/** The system permission screen opens once, and only while the grant is missing. */
export function shouldAskAlwaysOnTopConsent(input: { granted: boolean; asked: boolean }): boolean {
  return !input.granted && !input.asked;
}
