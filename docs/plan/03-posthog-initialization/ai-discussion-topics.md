# AI Discussion Topics

Use these prompts to dig deeper into the PostHog integration:

1. Explain why short-lived Next.js route handlers should call `posthog.shutdown()` after server-side captures.
2. Review where each approved JobPilot PostHog event should live once profile, job search, and company research are implemented.
3. Compare server-side auth event capture with client-side auth event capture for OAuth flows.
4. Design the dashboard analytics queries for `job_found` and `company_researched` without adding new event names.
