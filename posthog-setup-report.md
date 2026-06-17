<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into JobPilot's auth foundation. Client-side tracking was initialized via `instrumentation-client.ts` (Next.js 15.3+ pattern) with a reverse proxy configured in `next.config.ts` to route events through `/ingest` for ad-blocker resistance. A server-side PostHog singleton was created in `lib/posthog-server.ts` using `posthog-node`. Two auth events are now tracked server-side: `user_signed_in` fires in the OAuth callback route with user identification, and `user_signed_out` fires in both the `signOut` Server Action and the `/api/auth/sign-out` route handler. All existing InsForge auth code was preserved — PostHog was added alongside without restructuring.

| Event | Description | File |
| --- | --- | --- |
| `user_signed_in` | OAuth sign-in completed. Fires `identify()` + `capture()` with user ID and email. | `app/api/auth/callback/route.ts` |
| `user_signed_out` | User session cleared. Fires `capture()` with user ID before redirect. | `app/actions/auth.ts`, `app/api/auth/sign-out/route.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) dashboard](https://us.posthog.com/project/474308/dashboard/1724464)
- [Sign-ins over time](https://us.posthog.com/project/474308/insights/85MAIFdR)
- [Sign-outs over time](https://us.posthog.com/project/474308/insights/ZAq9sTMe)
- [Total sign-ins (30 days)](https://us.posthog.com/project/474308/insights/vyGUzjNv)
- [Auth activity comparison](https://us.posthog.com/project/474308/insights/HfZtXrLV)
- [Unique users signed in (30 days)](https://us.posthog.com/project/474308/insights/tINjefFo)

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any CI/CD environment configuration so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — currently `identify` is called server-side at OAuth callback; verify that a user returning to the app in a new browser session is also re-identified (e.g., via a client component on the dashboard that reads the session and calls `posthog.identify()`).

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
