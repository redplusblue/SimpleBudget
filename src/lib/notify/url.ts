// Client-safe: the same check runs in the settings forms and on the server.

export const DISCORD_WEBHOOK = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s]+$/i;

/** A message to show when `url` can't be used for `kind`, or null when it is fine. */
export function notifyUrlProblem(kind: string, url: string): string | null {
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return "Use a full address starting with http:// or https://";
  if (kind === "discord" && !DISCORD_WEBHOOK.test(url)) return "That doesn't look like a Discord webhook URL";
  return null;
}
