export interface RoleInput {
  jd: string;
  company_url: string;
  days: number;
}

export function validateRole(role: RoleInput): string | null {
  if (!role.jd.trim()) return "Add a job description.";
  if (role.jd.length > 30_000) return "Keep the description under 30,000 characters.";
  try {
    const url = new URL(role.company_url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return "Use a valid HTTP or HTTPS company URL.";
  } catch {
    return "Use a valid HTTP or HTTPS company URL.";
  }
  if (!Number.isInteger(role.days) || role.days < 1 || role.days > 365)
    return "Days must be an integer from 1 to 365.";
  return null;
}
