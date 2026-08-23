# Feature Backlog

Features that would make the product stronger and easier to operate.

## Messaging

- [x] Message history endpoint with pagination, filters, and search.
- [x] Bulk message queue with retry, backoff, and delivery reporting.
- [x] Message templates with variables.
- [x] Delivery/read status tracking where supported by WhatsApp Web events.
- [x] Webhook callbacks for external API users when messages succeed or fail.

## Contacts

- [x] CSV or Excel import for clients.
- [x] Tags, lists, and segments for client targeting.
- [x] Duplicate detection and phone normalization preview before import.

## WhatsApp Sessions

- [x] Session status endpoint showing `starting`, `pending`, `ready`, and `disconnected`.
- [x] QR refresh endpoint.
- [x] Multi-session management if one user needs more than one WhatsApp number.
- [x] Admin tools to disconnect, restart, or inspect sessions.

## API Tokens

- [x] Token names.
- [x] Expiration dates.
- [x] Last-used timestamp.
- [x] Scoped permissions, such as send-only or read-only.
- [x] Token rotation flow.

## Admin And Operations

- [x] Health check endpoint.
- [x] Basic admin dashboard endpoints.
- [x] Structured audit logs.
- [x] Rate limit visibility and per-user usage stats.
- [x] Environment-based configuration documentation.
