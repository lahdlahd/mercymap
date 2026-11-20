# Milestone 7 live test results

**Status: passed on the live Supabase project, 20 November 2026.**
Tested by the project owner on Windows (app at `http://localhost:3000`), Grace
Community Church owner in the normal window and Living Faith Church owner in an
InPrivate window. Made-up data only.

| Step | Result |
|---|---|
| A1. Migration `20261120110000_notifications_volunteers.sql` applied; check query | Pass: `0`, `7`, `false` |
| A2. Code on `milestone-7-notifications-volunteers`, app running | Done (from Command Prompt in `C:\Users\USER\mercymap`) |
| 1–2. Public request notifies Grace staff | Pass: bell count; "New request MM-E0CEF5-41CC62", "Food and groceries · online form", no name or description |
| 3–4. Open request marks read; Mark all as read | Pass: "You are all caught up." |
| 5–6. Volunteer needs consent for a phone; added | Pass: consent ticked and recorded; skills tidied to "driving, has a car" |
| 7. Low stock after approving 8 of 10 Rice Bags | Pass: `MM-BFFC6D-37E705` approved, 8 Bag reserved; "Stock running low: Rice Bags — 2 Bag available of 10." |
| 8. Task brief | Pass: reference, "Help: 8 Bag (Rice Bags)", "Area: Ijapo"; no name or story; phone line only when ticked |
| 9. Task given | Pass: task card with Copy brief, Send on WhatsApp and status buttons; "Task given to Bala driver." |
| 10. WhatsApp link | Not checked (optional) |
| 11. Started → Completed | Pass: Completed with time; request stayed Approved |
| 12. Decline cancels open tasks and returns stock | Pass: Declined; Chi Helper's task Cancelled; Bala driver's stays Completed; Rice Bags back to 10 available, 0 reserved |
| 13. Living Faith sees nothing of Grace's | Pass: "There are no volunteers yet." and "No notifications yet." |
| 14. Audit log | Pass: `assignment.completed` 1, `assignment.created` 2, `assignment.in_progress` 1, `volunteer.created` 2 |

No defects found.
