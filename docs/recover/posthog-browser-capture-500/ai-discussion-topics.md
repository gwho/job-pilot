# AI Discussion Topics — PostHog Browser Capture 500

Use these prompts for deeper follow-up:

1. Explain the tradeoffs between a PostHog direct browser host and a first-party `/ingest` reverse proxy in development and production.
2. Review whether JobPilot should keep PostHog autocapture disabled given the approved event list in `context/code-standards.md`.
3. Design a route-handler PostHog proxy for Next.js App Router if production rewrites fail on the deployment host.
4. Audit the six approved JobPilot analytics events and identify the safest insertion point for each future feature.
5. Explain how to verify PostHog browser and server events separately using DevTools, server logs, and the PostHog activity feed.
