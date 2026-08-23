# TODO

Use this file as the working checklist for fixes.

## Done

- [x] Create review and planning documents.
- [x] Fix WhatsApp session schema so pending QR sessions can be saved safely.
- [x] Add missing schedule routes for list, pause, and resume.
- [x] Refactor duplicated message sending into a shared service.
- [x] Move server port default and local environment template into config.
- [x] Convert database layer from MongoDB/Mongoose to MySQL/Sequelize.
- [x] Move CORS origin into environment-driven config.
- [x] Create local MySQL database and verify the backend starts on port 3000.

## In Progress

- [x] Add broader integration tests for auth, clients, messages, and schedules.

## Next

- [x] Add centralized phone number normalization and validation.
- [x] Hash API tokens and only show the raw token once on creation.
- [x] Replace request-local schedule timers with a DB-backed scheduler service.
- [x] Remove internal error details from public API responses.
- [x] Add initial automated tests for phone validation and API token hashing.
- [x] Add integration tests for auth, clients, tokens, messages, and schedules.
