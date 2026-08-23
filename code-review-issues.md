# Code Review Issues

This file tracks the main issues found during the backend review.

## High Priority

- [x] WhatsApp session QR update can fail because `sessionData` is required before authentication finishes.
- [x] API tokens are stored and returned as plaintext.
- [x] Scheduled repeated messages use in-memory `setTimeout`, so jobs stop after server restart or deploy.
- [x] Schedule controller methods exist but are not exposed through routes.
- [x] Message sending logic is duplicated across controllers.

## Medium Priority

- [x] Phone number validation and normalization are not consistent across endpoints.
- [x] Internal error details are returned in several API responses through `fullError` or raw `error.message`.
- [x] CORS origin is hardcoded to `http://localhost:4200`.
- [x] Server port has no fallback if `PORT` is missing.
- [x] There is no global error handler or 404 handler.
- [x] There are no automated tests.

## Low Priority

- [x] README and `api-docs.md` contain duplicated content.
- [x] Some comments show encoding corruption in `whatsappService.js`.
- [x] `nodemon` is listed in production dependencies instead of dev dependencies.
- [x] Unused or accidental files exist in the repo, such as empty `git` and `desktop.ini`.
