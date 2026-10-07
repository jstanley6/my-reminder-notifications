# My Reminder Notifications

Backend for a reminder app: scheduled checks find due reminders and deliver them as web or mobile notifications.

## How it works
- A **GitHub Actions** workflow (`.github/workflows/check-reminder.yml`) triggers the `check-reminder` function on a schedule.
- `check-reminder` queries the Supabase `reminders` table for pending reminders that are due and not yet delivered.
- For each one it calls `send-web-reminder` or `send-mobile-reminder`; `complete-remimder` marks a reminder as done.

## Tech
TypeScript, Deno, Supabase (Postgres + Edge Functions), GitHub Actions.

## Notes
All keys are read from environment variables / GitHub secrets, and none are stored in the repo.