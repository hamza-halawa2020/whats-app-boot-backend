"# whats-app-boot-backend" 

## Local Setup

This backend uses MySQL through Sequelize.

1. Create a MySQL database:

```sql
CREATE DATABASE whatsapp_boot_backend CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. Copy `.env.example` to `.env` and update the database credentials:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=whatsapp_boot_backend
DB_USER=root
DB_PASSWORD=your_mysql_password
```

3. Install dependencies and start the app:

```bash
npm install
npm start
```

The app will create or sync the required MySQL tables on startup.

WhatsApp Messaging API (External)
Overview
This API allows you to send WhatsApp messages and manage API tokens for your connected WhatsApp account.
Authentication

JWT Authentication: Used for internal endpoints (/api/tokens/*). Requires Authorization: Bearer <your_jwt_token> (from POST /api/users/login).
API Token Authentication: Used for external endpoint (/api/external/messages/send). Requires X-API-Token: <your_api_token>.

1. Generate API Token
POST /api/tokens/generate
Generate a permanent API token for sending messages.
Authentication

Header: Authorization: Bearer <your_jwt_token>

Response
Success (200):
{
  "success": true,
  "message": "API token generated successfully",
  "token": "550e8400-e29b-41d4-a716-446655440000"
}

Example (cURL)
curl -X POST http://hamza.com/api/tokens/generate \
-H "Authorization: Bearer <your_jwt_token>" \
-H "Content-Type: application/json"

2. Get API Tokens
GET /api/tokens
Fetch all API tokens for the authenticated user.
Authentication

Header: Authorization: Bearer <your_jwt_token>

Response
Success (200):
{
  "success": true,
  "message": "API tokens fetched successfully",
  "tokens": [
    {
      "_id": "60c72b2f9b1e8a001c8b4567",
      "token": "550e8400-e29b-41d4-a716-446655440000",
      "phone": "+201234567890",
      "createdAt": "2025-05-26T18:00:00.000Z"
    }
  ]
}

Example (cURL)
curl -X GET http://hamza.com/api/tokens \
-H "Authorization: Bearer <your_jwt_token>"

3. Revoke API Token
POST /api/tokens/revoke
Revoke an API token.
Authentication

Header: Authorization: Bearer <your_jwt_token>

Request Body
{
  "tokenId": "60c72b2f9b1e8a001c8b4567"
}

Response
Success (200):
{
  "success": true,
  "message": "API token revoked successfully"
}

Example (cURL)
curl -X POST http://hamza.com/api/tokens/revoke \
-H "Authorization: Bearer <your_jwt_token>" \
-H "Content-Type: application/json" \
-d '{"tokenId": "60c72b2f9b1e8a001c8b4567"}'

4. Send Message
POST /api/external/messages/send
Send a WhatsApp message to a phone number.
Authentication

Header: X-API-Token: <your_api_token>

Request Body
{
  "phone": "+201234567890",
  "message": "Your verification code is 123456"
}

Response
Success (200):
{
  "success": true,
  "message": "Message sent successfully",
  "phone": "+201234567890"
}

Example (cURL)
curl -X POST http://hamza.com/api/external/messages/send \
-H "X-API-Token: 550e8400-e29b-41d4-a716-446655440000" \
-H "Content-Type: application/json" \
-d '{
  "phone": "+201234567890",
  "message": "Your verification code is 123456"
}'

Notes

Ensure your WhatsApp account is connected via the dashboard (QR code).
Phone numbers must include country code (e.g., +20 for Egypt).
API tokens are permanent until revoked.
Contact support for assistance.

"# whats-app-boot-backend" 
