// MERCYMAP's first churches are in Nigeria, so times are shown in West Africa
// Time whatever the server's own clock is. A per-church time zone can replace
// this later.
const TIME_ZONE = "Africa/Lagos";

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE }).format(new Date(iso));
}
