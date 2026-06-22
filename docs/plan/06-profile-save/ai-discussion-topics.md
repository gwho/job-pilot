# AI Discussion Topics — Feature 06: Profile Save Logic

## Server Actions

1. "Walk me through exactly what happens when a Next.js Server Action is called from a client component. Where does it run? How does it get the session cookie?"
2. "Why does `useTransition` keep the UI interactive during a Server Action? What would happen without it?"
3. "When would I use FormData vs a typed object as a Server Action parameter? What are the serialization rules?"

## Shared Utilities

4. "What's the risk of keeping the same logic in two places? Give me a real example of how that kind of divergence causes a production bug."
5. "When should I extract logic to a shared utility vs keep it inline? What's the threshold?"

## InsForge Storage

6. "Why doesn't InsForge storage have an upsert option? What are the design trade-offs of auto-rename vs overwrite?"
7. "When should I use a signed URL vs a public URL? What are the security implications of each?"
8. "What happens to old files if I don't remove them before re-uploading? Is that ever acceptable?"

## PostHog / Analytics

9. "Why does `await posthog.shutdown()` matter in a serverless function? What happens if you skip it?"
10. "What's the difference between a one-time event (like profile_completed) and a recurring event? How do you gate them correctly in a server action?"

## Database Design

11. "Why do we read `is_complete` before upserting instead of after? Explain the race condition that reading-after-write could cause."
12. "Why is `resume_pdf_key` stored separately from `resume_pdf_url`? When would the URL be insufficient?"
