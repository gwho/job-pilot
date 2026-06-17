# AI Discussion Topics

1. Explain the tradeoff between direct PostHog ingestion in development and reverse-proxied ingestion in production.
2. Review whether JobPilot should keep PostHog autocapture disabled permanently given the fixed event list in `code-standards.md`.
3. Design a typed `captureClientEvent` helper for the future `job_search_started` event without allowing arbitrary event names.
4. Compare browser-side PostHog captures with server-side captures for authenticated user actions.
