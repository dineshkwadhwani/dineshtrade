# Retrospection Audit — Testing & Deployment Checklist

This document lists quick verification steps and deployment notes for the Retrospection audit timeline feature.

Local setup
- Ensure `SUPABASE_SERVICE_KEY` is set in your environment (server-only). The admin client is lazy-loaded and will throw if missing.
- Start the app in a server environment (Next.js dev):

```bash
npm run dev
```

Quick manual checks
- Open the Retrospection tab: `/trades?view=retro` and pick a date known to have activity.
- Confirm the "Audit timeline" section appears and lists timed bullets with actor, action, and optionally details.
- Use the Action and Actor filters to narrow results. Try Export JSON and open the downloaded file.
- Expand an item's details and verify the JSON payload matches the audit row.

Edge cases & test ideas
- Date window correctness: verify events written near IST midnight appear under the correct IST date. Test with records around `23:59:59+05:30` UTC conversion.
- Large volume: test with >500 events in a day; UI paging should allow traversal and export should include the filtered set.
- Authorization: reviewing the server-side Supabase admin access is read-only in this code path; ensure only authorized sessions can call the endpoints that build the report.

Automated tests (suggested)
- Unit: mock `getSupabaseAdmin()` to return known rows and assert `buildDailyReport()` includes `auditEvents` for a date.
- Integration/E2E: using Playwright, load `/trades?view=retro`, select date, assert filtering and export actions work.

Deployment notes
- Deploy as usual; ensure `SUPABASE_SERVICE_KEY` is provided to the runtime.
- Monitor logs for `[retrospective] audit fetch failed:` and fallback behavior (report still builds without failing).

Rollback
- If audit fetch causes issues, the report falls back to an empty `auditEvents` array. Rolling back the change (revert commit) restores previous behavior.

Questions
- If you want audit events to be accessible via a dedicated API (e.g., `/api/audit?date=`) for other consumers, I can add that next.
