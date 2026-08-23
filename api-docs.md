# API Docs

Base URL: `http://localhost:3000`

## Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Authenticated internal endpoints require:

```http
Authorization: Bearer <jwt>
```

## WhatsApp Sessions

- `POST /api/whatsapp/start`
- `GET /api/whatsapp/sessions`
- `GET /api/whatsapp/status?phone=<phone>`
- `POST /api/whatsapp/qr/refresh`
- `POST /api/whatsapp/restart`
- `POST /api/whatsapp/delete`

Session actions use the authenticated user's phone by default. Pass `phone` in the body or query string to manage another session.

## Messages

- `POST /api/messages/messages`
- `GET /api/messages/history?page=1&limit=20&phone=<phone>&status=sent&search=text`
- `POST /api/messages/broadcast`
- `GET /api/messages/schedules`
- `POST /api/messages/schedules/toggle`

## Message Templates

- `GET /api/messages/templates`
- `POST /api/messages/templates`
- `PUT /api/messages/templates/:id`
- `DELETE /api/messages/templates/:id`

## Clients

- `GET /api/clients`
- `POST /api/clients`
- `PUT /api/clients/:id`
- `DELETE /api/clients/:id`
- `POST /api/clients/import/preview`
- `POST /api/clients/import`

Client import accepts either:

```json
{
  "rows": [
    {
      "phone": "+201112223333",
      "name": "Client Name",
      "tags": ["lead"],
      "segment": "sales"
    }
  ]
}
```

or CSV text:

```json
{
  "csv": "+201112223333,Client Name,lead|vip,sales"
}
```

## API Tokens

- `POST /api/tokens/generate`
- `GET /api/tokens`
- `PUT /api/tokens/:tokenId`
- `POST /api/tokens/:tokenId/rotate`
- `POST /api/tokens/revoke`

Token generation supports:

```json
{
  "name": "Production",
  "scopes": ["messages:send"],
  "webhookUrl": "https://example.com/webhook",
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

The raw API token is returned only once when generated or rotated. Stored tokens are hashed.

## External API

External message sending requires:

```http
X-API-Token: <raw_api_token>
```

- `POST /api/external/messages/send`

## Operations

- `GET /health`
- `GET /usage`
- `GET /rate-limits`
- `GET /admin/dashboard`
- `GET /admin/audit-logs`
- `GET /admin/sessions`
- `POST /admin/sessions/:id/disconnect`

Admin endpoints require a JWT for a user with `role = "admin"`.
