# Wallet Points TODO

## Done

- Added admin-controlled app settings for signup gift points, message point cost, and daily message limit.
- Added `/api/admin/settings` for admin read/update.
- Added `/api/settings` for authenticated users to read current sending rules.
- Applied dynamic message point cost to single messages, broadcasts, and scheduled messages.
- Added daily message limit enforcement for single messages, broadcasts, and scheduled messages.
- Added one-time signup verification gift after successful WhatsApp OTP verification.
- Updated the admin frontend page with a platform settings panel.
- Updated the send message frontend page to display message cost and calculate broadcast points.

## Still To Check

- Confirm the desired production values in the admin page after deployment.
- Run backend tests after Node is available in the local shell PATH.
- Optional: show remaining daily quota to users instead of only the configured daily limit.
