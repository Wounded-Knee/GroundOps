/** Emails in PLATFORM_ADMINISTRATOR_EMAILS, compared without case or surrounding spaces. */
export function isPlatformAdministrator(email: string | null): boolean {
  if (!email) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return administratorEmails().has(normalized);
}

function administratorEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMINISTRATOR_EMAILS ?? "";
  const emails = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set(emails);
}
