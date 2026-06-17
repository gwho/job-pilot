# AI Discussion Topics — PostHog Client Guard

Use these prompts for deeper review:

1. Explain why optional SDK initialization should be paired with guarded SDK helper functions.
2. Compare checking `posthog.__loaded` inside a shared wrapper versus checking env vars inside every component.
3. Review whether JobPilot should expose a `capturePostHogEvent()` browser helper for future approved client-side events.
4. Audit the difference between browser-side PostHog identity and server-side PostHog event capture.
