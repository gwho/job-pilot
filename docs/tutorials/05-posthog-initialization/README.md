# Tutorial 05 — Implementing Full-Stack Analytics with PostHog

**After completing this tutorial you will understand:** how to integrate PostHog across a Next.js App Router project, why serverless server-side analytics require explicit `shutdown()` flushes, how to securely map authenticated InsForge user IDs to PostHog browser profiles, and how to structure a type-safe tracking taxonomy to avoid event clutter.

> [!NOTE]
> **Prerequisites:** Familiarity with Next.js Server Actions, Route Handlers, and basic React Client Components. Open your editor to [lib/posthog-server.ts](file:///Users/jessejames/Desktop/job-pilot/lib/posthog-server.ts) and [app/api/auth/callback/route.ts](file:///Users/jessejames/Desktop/job-pilot/app/api/auth/callback/route.ts) to follow along with the real codebase.

---

## How To Use An LLM Before This Tutorial

Analytics has two separate problems: event taxonomy and reliable delivery. Use an LLM
to rehearse both before reading the PostHog code.

Prompt 1:

```text
Teach me the difference between browser analytics and server-side analytics in a
Next.js app. Use sign-in and sign-out events as examples. Ask me which side should
capture each event and why.
```

Prompt 2:

```text
Explain why serverless analytics clients need explicit flushing or shutdown.
Use a route handler that returns quickly. Ask me what happens to queued events if the
function ends before the queue flushes.
```

Prompt 3:

```text
Teach me type-safe analytics event names in TypeScript.
Use a string union for allowed events and show how it prevents dashboard clutter.
Then quiz me on valid vs invalid event names.
```

Practice before continuing:

- Explain why `user_signed_in` belongs after OAuth callback success.
- Predict why `posthog.shutdown()` appears in a `finally` block.
- Say why event names should be constrained instead of arbitrary strings.

---

## The Analytics Architecture

Modern Next.js apps require two instances of analytics clients to capture the full lifecycle:

```
[Browser PostHog SDK]
  ├─ Initialized globally in instrumentation-client.ts
  ├─ Captures client-side clicks, scrolls, and rage-clicks.
  └─ Identity syncs silently via PostHogIdentity.tsx.

[Server PostHog SDK (posthog-node)]
  ├─ Initialized on-demand per request in lib/posthog-server.ts
  ├─ Captures hard security/auth events (user_signed_in, user_signed_out).
  └─ MUST be flushed and shut down before the server response completes.
```

---

## 1. Type-Safe Server Tracking

Let's examine how server-side PostHog is implemented in [lib/posthog-server.ts](file:///Users/jessejames/Desktop/job-pilot/lib/posthog-server.ts).

```typescript
type PostHogEvent =
  | "user_signed_in"
  | "user_signed_out"
  | "job_search_started"
  | "job_found"
  | "profile_completed"
  | "company_researched";
```
### Why restrict event names?
If you let developers pass any `string` to the analytics tracker, your analytics dashboard will soon have `"User Signed In"`, `"user signed in"`, and `"user_login"`. Constraining the union type means **TypeScript enforces analytics taxonomy**. 

### The Serverless Shutdown Rule

Look at how events are captured:

```typescript
export async function captureServerEvent({ distinctId, event, properties = {} }: CaptureServerEventInput): Promise<void> {
  const posthog = createPostHogServer();
  if (!posthog) return;

  try {
    posthog.capture({ distinctId, event, properties });
  } finally {
    await posthog.shutdown();
  }
}
```

> [!WARNING]
> **The Flush Trap:** Serverless functions (like Vercel Route Handlers) freeze execution the millisecond the HTTP response is returned. If PostHog puts the `capture` event in a background queue to batch send it (which is its default behavior), the server will shut down before the batch is sent. You will permanently lose analytics events.

**The Fix:**
1. Initialize the client with `flushAt: 1` and `flushInterval: 0` (send immediately).
2. Use `try...finally { await posthog.shutdown(); }` to explicitly block the Node.js thread until the network request to PostHog completes.

---

## 2. Capturing the Golden Auth Moment

Where is the best place to track a successful sign in? Not the browser! If you track sign-ins via client-side React `useEffect`, ad-blockers might block it, or a fast redirect might kill the page before tracking fires.

Look at the OAuth callback [app/api/auth/callback/route.ts](file:///Users/jessejames/Desktop/job-pilot/app/api/auth/callback/route.ts):

```typescript
const { data, error } = await auth.exchangeOAuthCode(code, verifier);

if (data?.user) {
  await identifyServerUser({
    distinctId: data.user.id,
    properties: { email: data.user.email },
  });
  await captureServerEvent({
    distinctId: data.user.id,
    event: "user_signed_in",
    properties: { userId: data.user.id, email: data.user.email },
  });
}

return NextResponse.redirect(new URL("/dashboard", request.url));
```
**Why here?**
* This is the exact microsecond the backend verifies the user is legitimate.
* We have the definitive `data.user.id` (which is our canonical `profiles.id`).
* We wait for `captureServerEvent` to complete, then redirect safely to `/dashboard`.

---

## 3. The Returning User Identity Bridge

When a user logs in via OAuth, the server tracks it. But what if they close the tab, come back tomorrow, and open the dashboard? Their session cookie keeps them logged in. But how does the *browser's* PostHog SDK know who they are so it can track their frontend interactions?

Enter [components/analytics/PostHogIdentity.tsx](file:///Users/jessejames/Desktop/job-pilot/components/analytics/PostHogIdentity.tsx):

```tsx
"use client";

import { useEffect } from "react";
import { identifyPostHogUser, resetPostHogUser } from "@/lib/posthog-client";

export function PostHogIdentity({ userId, email }: { userId: string | null; email: string | null; }) {
  useEffect(() => {
    if (userId) {
      identifyPostHogUser(userId, email);
    } else {
      resetPostHogUser();
    }
  }, [email, userId]);

  return null; // Renders nothing! It is a pure logic bridge.
}
```

**How it works:**
1. The Next.js Root Layout (`app/layout.tsx`) reads the current session securely from the server via InsForge.
2. It passes `session.user.id` down to this invisible Client Component.
3. The component calls `posthog.identify(userId)` on mount. Now all client-side clicks are correctly attributed to the InsForge UUID.

---

## 4. The Sign-Out Danger: Identity Leakage

When a user logs out, the server destroys their session cookie. But the browser PostHog SDK stores the user's `distinctId` in `localStorage`. 
If you don't clear it, the next person to use that browser will be tracked under the previous user's profile!

That is why `resetPostHogUser()` calls `posthog.reset()`. We also execute this reset immediately when the user clicks the Sign Out button, before the server even processes the request.

---

## 5. Explicit Event Strategy

In `instrumentation-client.ts`, PostHog is configured with `capture_pageview: false`. 

**Why disable auto-capture?**
Auto-capturing page views generates a massive amount of "noise". In a product-focused app like JobPilot, we care about specific milestones:
* `job_search_started`
* `job_found`
* `profile_completed`
* `company_researched`

By forcing developers to write explicit `captureServerEvent()` lines into the Server Actions that perform these tasks, we ensure high-signal, accurate analytics dashboards.

---

## 6. Self-Check Quiz

Test your understanding before expanding the answers!

**1. Why does `captureServerEvent` call `await posthog.shutdown()` in a `finally` block?**

<details>
<summary>Reveal answer</summary>

Serverless functions (Route Handlers, Server Actions) immediately terminate their process once a response is returned. By default, PostHog queues events to send in batches. If the function terminates before the batch flushes, the analytics event is destroyed. `await posthog.shutdown()` flushes the queue synchronously before the function returns.

</details>

---

**2. Why do we disable `capture_pageview: false` in the browser SDK?**

<details>
<summary>Reveal answer</summary>

To enforce an explicit, high-signal event taxonomy. Automatic pageview capturing collects a massive amount of noise, making funnels harder to build. By only tracking approved milestone events (`user_signed_in`, `job_found`, etc.), the data remains clean and actionable.

</details>

---

**3. What happens if you forget to call `posthog.reset()` on sign-out?**

<details>
<summary>Reveal answer</summary>

The browser PostHog SDK caches the user's `distinctId` in localStorage/cookies. If a new user logs in on the same browser (or browses logged out), their actions will be attributed to the previous user's identity, corrupting your analytics data.

</details>

---

**4. Why is `PostHogEvent` defined as a literal union type instead of `string`?**

<details>
<summary>Reveal answer</summary>

It prevents developers from accidentally capturing events with typos (e.g., `"user_login"` instead of `"user_signed_in"`). TypeScript will throw a compile error if an unapproved event name is passed into `captureServerEvent`.

</details>

---

**5. Why capture `user_signed_in` inside the OAuth callback route handler instead of inside a React `useEffect` on the Dashboard?**

<details>
<summary>Reveal answer</summary>

The callback route handler is the absolute source of truth where the OAuth code is successfully exchanged for a session. It cannot be blocked by browser ad-blockers, and it executes 100% of the time, avoiding the unreliability of client-side renders and redirects.

</details>

---

## 7. Extend It (Challenges)

Apply your knowledge to upcoming features!

---

### Challenge 1 — Track the "Generate Resume" Event
Imagine you are building Feature 08 (Resume PDF Generation). You need to add analytics tracking for when a user successfully generates a PDF.
1. Update the `PostHogEvent` type union in `lib/posthog-server.ts` to support `"resume_generated"`.
2. Draft the `captureServerEvent` snippet that you would place inside `app/api/resume/generate/route.ts` upon success. Ensure you pass `userId` and a property for `resumeLengthPages`.

---

### Challenge 2 — The Missing "Error" Event
Sometimes API calls fail (e.g. Adzuna API is down). We want to track this.
1. Should this be tracked via PostHog or via `agent_logs` in our database? 
2. What are the trade-offs of sending operational error logs to a product analytics tool like PostHog versus a database logging table? 

*(Hint: Review the database architecture discussed in Tutorial 04 regarding `agent_logs`)*
