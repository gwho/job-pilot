# AI Discussion Topics — Auth App URL Guard

Use these prompts for deeper review:

1. Explain why OAuth redirect URLs should fail early when the app origin is missing.
2. Compare throwing a descriptive configuration error with redirecting to a generic login error page.
3. Review which environment variables in JobPilot should be guarded at use sites versus validated at boot.
4. Walk through how `NEXT_PUBLIC_APP_URL` differs from InsForge backend URLs and PostHog host URLs.
