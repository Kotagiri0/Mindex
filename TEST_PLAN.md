# Test Plan

## Unit tests
- `src/lib`: auth validation, storage migrations, db client merge logic, Groq error handling, Google auth token checks, Google Calendar token usage, UUID fallback, task sorting, theme context, voice hook state, supabase placeholders.
- `api/*`: CORS and method handling, missing env failures, happy-path responses with mocked I/O.
- `server-bot.ts`: route registration behavior and early exits on missing configuration.
- `src/components` & `src/App.tsx`: export existence checks for public UI components.

## Integration tests
- Express server endpoints: `/api/config`, `/metrics`, auth failure on `/api/data/task`.
- Rate limiting behavior on `/api/data/task` using repeated requests.

## Edge coverage
- Empty inputs: missing credentials, missing messages, no tasks.
- Max/limit behavior: rate-limit threshold.
- Concurrency: parallel thread saves.
- Auth failures: missing token and invalid session.
