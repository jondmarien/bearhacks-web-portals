/**
 * Canonical attendee profile role taxonomy.
 *
 * Must stay in sync with `PROFILE_ROLES` in
 * `bearhacks-backend/routers/profiles.py` — the server rejects any value
 * outside this set with HTTP 422.
 */
export const PROFILE_ROLES = [
  "Hacker",
  "Organizer",
  "Mentor",
  "Volunteer",
  "Sponsor",
  "Director",
  "Founder",
] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];

export const PROFILE_ROLE_OPTIONS = PROFILE_ROLES.map((role) => ({
  value: role,
  label: role,
}));

/** Matches backend `MAX_DISPLAY_NAME_LENGTH`. */
export const MAX_DISPLAY_NAME_LENGTH = 80;
