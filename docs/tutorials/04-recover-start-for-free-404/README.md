# Tutorial 04 — Diagnosing a 404 the Right Way: Failure Modes, False Leads, and Incomplete Fixes

**After completing this tutorial you will understand:** the three-failure-mode framework
the `/recover` skill uses to triage a broken feature, why "test it for real" beats
"reason about what the framework should do" when the two disagree, how a phased build
plan produces *expected* temporary 404s that look like bugs but aren't, and why fixing
the reported symptom isn't the same as fixing the system the user actually needs.

> [!NOTE]
> **Prerequisites:** This tutorial assumes you've read
> [`docs/tutorials/02-auth/README.md`](../02-auth/README.md) — it explains
> `proxy.ts`, `lib/auth.ts`'s `getCtaHref()`, and the OAuth flow in depth. This tutorial
> reuses that knowledge rather than re-deriving it, and at one point directly contradicts
> a claim that *sounds* like something from that tutorial — pay attention to which one.
> Have your editor open to
> [docs/recover/start-for-free-404/](../../recover/start-for-free-404/) and
> [docs/project-review/placeholder-pages-header-signout/](../../project-review/placeholder-pages-header-signout/),
> the two real incident folders this tutorial is built from.

---

## How To Use An LLM Before This Tutorial

Use an LLM as a debugging coach before reading the incident. The warm-up goal is to
practice classifying failures and testing claims instead of accepting plausible stories.

Prompt 1:

```text
Teach me a three-mode recovery framework for software bugs:
1 isolated bug, 2 polluted session from stacked fixes, 3 wrong foundation.
Give me examples and quiz me on which mode each example belongs to.
```

Prompt 2:

```text
Explain why a phased build can produce expected temporary 404s.
Use a homepage link to a future dashboard as the example. Ask me when this is a bug and
when it is a missing placeholder.
```

Prompt 3:

```text
Teach me how to falsify a framework claim with a cheap runtime check.
Use a protected route and curl redirect as the example. Ask me to write the expected
output if the middleware/proxy ran.
```

Practice before continuing:

- Classify the Start for free 404 as failure mode 1, 2, or 3.
- Decide what one command would prove whether route protection is running.
- Explain why a targeted fix can still need a follow-up project review.

---

## The incident, in one sentence

A logged-in user clicked **"Start for free"** on the homepage and landed on a `404 This
page could not be found` instead of a dashboard. Two real, separate documents in this
repo record what happened next: `docs/recover/start-for-free-404/` (the initial
diagnosis and fix) and `docs/project-review/placeholder-pages-header-signout/` (a
follow-up review that caught what the first fix missed). This tutorial walks through
both, because the second one is at least as instructive as the first.

---

## Part 1 — The `/recover` triage framework

Before touching any code, the `/recover` skill forces a classification question: **what
kind of broken is this?** There are three failure modes, and which one you're in
determines whether you should make a small targeted edit, throw away a chain of bad
patches, or rethink the design entirely.

```
Symptom observed
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ Is this the FIRST fix attempt, and is the symptom isolated   │
│ (rest of the app works, one specific thing is broken)?       │
└─────────────────────────────────────────────────────────────┘
      │ yes                                  │ no
      ▼                                      ▼
 FAILURE MODE 1                    Have there been multiple
 "A specific, isolated              stacked fix attempts that
  thing is broken"                  made things progressively
  → small, targeted fix             worse or murkier?
                                          │ yes            │ no
                                          ▼                ▼
                                   FAILURE MODE 2     FAILURE MODE 3
                                   "Polluted session"  "Wrong foundation"
                                   → reset/revert the   → the implementation
                                     compounding         itself is built on a
                                     attempts, restart   misunderstood
                                     diagnosis clean      requirement; needs a
                                                          redesign, not a patch
```

This case was classified as **Failure Mode 1**. From `docs/recover/start-for-free-404/explanation.md`:

> Failure Mode 2 (polluted session) requires multiple stacked, worsening fix attempts —
> this was the first pass at the problem, with no prior failed attempts compounding it.
> Failure Mode 3 (wrong foundation) requires the implementation itself to be conceptually
> wrong — but the auth redirect logic (`getCtaHref()`) was correct; it matched the
> build-plan spec exactly.

**Checkpoint:** Why does "the auth logic matched the build-plan spec exactly" rule out
Failure Mode 3, even though the symptom (404) looks just as broken as any other failure?
(Answer: Mode 3 is about a *misunderstood requirement* — code that does the wrong thing
on purpose because someone misread the spec. Here the spec said "redirect to `/dashboard`
when logged in," and the code did exactly that. The thing that didn't exist was the page
on the other end of that redirect — a missing *implementation*, not a wrong *design*.)

**Try it yourself:** Open `docs/recover/start-for-free-404/explanation.md` §1 in full
and write, in your own words, one sentence each for what evidence would have pointed to
Mode 2 instead, and what evidence would have pointed to Mode 3 instead. Then compare your
answer to the file's own reasoning — did you find the same distinguishing signal?

---

## Part 2 — Root cause: a forward reference, not a bug

Here's the actual function under suspicion — you've seen it before in Tutorial 02:

```ts
// lib/auth.ts
import { createInsforgeServer } from "@/lib/insforge-server";

export async function getCtaHref() {
  const insforge = await createInsforgeServer();
  const { data } = await insforge.auth.getCurrentUser();
  return data.user ? "/dashboard" : "/login";
}
```

This function is *correct*. When a session exists, it returns `/dashboard`. The 404
happened because, at the time this code ran, `app/dashboard/page.tsx` simply didn't
exist yet — Dashboard was planned as Feature 14 (Phase 5 of the build plan), and only
Features 01–02 (homepage, auth) were complete. The link pointed at a real future
destination that hadn't been built. That's not a bug; it's the expected shape of any app
built in phases, the moment you wire up navigation before every destination exists.

**Checkpoint:** If you were building a 10-phase app and Phase 1 already linked to
`/settings`, `/billing`, and `/team` — none of which exist yet — would each of those
produce a "Failure Mode 1" 404 in the same sense as this one? (Answer: structurally yes,
*if* each is independently isolated and a first attempt. But a competent build plan
usually avoids exposing those links in the UI before the page exists at all — which is
exactly the gap the follow-up review in Part 4 caught here: the *redirect logic* being
correct didn't mean the *user experience* around it was complete.)

---

## Part 3 — The false lead: don't trust a plausible-sounding claim over a live test

This is the most important transferable lesson in this whole incident, and it has
nothing to do with 404s specifically. While diagnosing, an exploration pass produced a
confident, specific, and **wrong** technical claim:

> `proxy.ts` "is never executed because Next.js expects `middleware.ts`."

If you've done Tutorial 02, you already know this is backwards for this codebase —
Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts`, the *opposite* of the
claim. But notice *why* this claim was plausible in the first place: `middleware.ts` was
the correct filename in Next.js 15 and earlier, so it's a true fact about an adjacent
version, misapplied here. This is exactly the kind of error that sounds authoritative
because part of it used to be true.

Here's how it was actually caught — not by re-reading the code more carefully, but by
running it:

```bash
# While logged out, hit a route proxy.ts is supposed to protect:
curl -i http://localhost:3000/dashboard
```

```
HTTP/1.1 307 Temporary Redirect
location: /login
```

A `307` to `/login` is only possible if `proxy.ts` ran. If the claim ("`proxy.ts` is
inert") were true, this `curl` would have returned a `200` with the dashboard's HTML (or
whatever unprotected response that route gives). It didn't — so the claim was falsified
in one command, and cross-checked a second way against a primary source already sitting
in `node_modules`:

```bash
cat node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md | head -20
```

That file states outright that `middleware` is the deprecated name and `proxy` is
current — the same conclusion the `curl` test gave, from a completely different angle.

**Checkpoint:** Why does "falsifiable and cheap to check" matter as a bar for deciding
whether to verify a claim before acting on it? (Answer: not every claim is worth
stopping to verify — but when a claim is both *specific* (makes a testable prediction:
"this file never runs") and *cheap to test* (one `curl` command, one file read), the cost
of checking is near zero compared to the cost of building a wrong fix on top of it. A
vague or expensive-to-verify claim might reasonably get provisional trust; this one had
no excuse not to be checked.)

**Try it yourself:** Reproduce both verification steps yourself right now:

```bash
npm run dev   # if not already running, in another terminal
curl -i http://localhost:3000/dashboard    # expect 307 → /login if logged out
curl -i http://localhost:3000/profile      # same
curl -i http://localhost:3000/find-jobs    # same
find node_modules/next/dist/docs -iname "proxy.md"
```

If your `curl` results match what's shown above, you've independently re-verified the
exact fact that overturned the false lead — from your own terminal, not from trusting
this tutorial's prose either.

---

## Part 4 — The fix, and what it left out

The fix that closed the original 404 ticket was three new files:

```tsx
// app/dashboard/page.tsx (as first written)
export default function DashboardPage() {
  return <div>Dashboard — coming soon</div>;
}
```

...one-line stubs for `app/dashboard/page.tsx`, `app/profile/page.tsx`, and
`app/find-jobs/page.tsx`. This was explicitly scoped as a throwaway placeholder, to be
replaced when Features 05, 09, and 14 actually get built. It worked: the 404 was gone.

But a later `/project-review` pass (a *different* check, run deliberately after the bug
fix, not during it) found the stub had quietly broken two of the project's own
established rules from `context/ui-rules.md` — rules that predated this fix and weren't
new requirements invented after the fact:

> - **Layer 1 (plan alignment):** the placeholders never imported `Navbar`, so the
>   header disappeared entirely on these routes... `app/layout.tsx` is a bare shell;
>   every page is responsible for rendering its own `Navbar`.
> - **Layer 2 (system integrity):** the placeholders ignored the "Cards" rule (every
>   content section lives in a white bordered card) and the "Empty States" rule (muted
>   description text plus a CTA). They also left `app/api/auth/sign-out/route.ts`
>   completely uncalled — the endpoint existed but nothing in the UI used it.
> - **Layer 3 (production readiness):** with no sign-out control anywhere, anyone who
>   signs in is stuck authenticated for the session's full lifetime with no in-app way to
>   reset state.

Here's the actual code that resulted from that review — open these files for real:

```tsx
// components/layout/ComingSoonCard.tsx
import { SignOutButton } from "@/components/layout/SignOutButton";

type Props = {
  title: string;
  description: string;
};

export function ComingSoonCard({ title, description }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-lg max-w-sm w-full">
      <h1 className="text-base font-semibold text-text-primary mb-1">{title}</h1>
      <p className="text-sm text-text-muted mb-6">{description}</p>
      <SignOutButton />
    </div>
  );
}
```

```tsx
// components/layout/SignOutButton.tsx
import { signOut } from "@/app/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="bg-surface border border-border text-text-primary text-sm font-medium px-4 py-2 rounded-md hover:bg-surface-secondary transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
```

```tsx
// app/dashboard/page.tsx (current, after the review)
import { Navbar } from "@/components/layout/Navbar";
import { ComingSoonCard } from "@/components/layout/ComingSoonCard";

export default function DashboardPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-background px-6">
        <ComingSoonCard
          title="Dashboard"
          description="Dashboard is next after the foundation auth flow is complete."
        />
      </main>
    </>
  );
}
```

`app/profile/page.tsx` and `app/find-jobs/page.tsx` are the same shape with different
`title`/`description` props — open them to confirm. Notice that `SignOutButton`'s `<form
action={signOut}>` is the exact same zero-client-JS pattern from the login page in
Tutorial 02 — same Server Action wiring, reused for the opposite direction of the auth
flow.

**Checkpoint:** Why was this caught by a *separate* `/project-review` pass instead of
during the original bug fix itself? (Answer, from the project's own
`docs/recover/start-for-free-404/explanation.md`: "a fix focused on 'did the error go
away' will not, by itself, ask 'does this match the rest of the system.' Both checks
matter, but they're different checks, run at different times, for good reason —
conflating them risks under-scoping the original fix while debugging is still in
progress." In other words: while you're mid-diagnosis trying to stop a 404, that's the
wrong moment to also audit design-system compliance — finish stopping the bleeding
first, then review with fresh eyes.)

**Try it yourself:** Run a live diff between "minimal stub" and "reviewed stub" by
temporarily reverting one file and comparing:

```bash
git log --oneline -- app/dashboard/page.tsx
git show <first-commit-hash>:app/dashboard/page.tsx   # the original one-liner, if committed
```

(If the original one-liner was never committed on its own, skip this — the point still
stands by comparing the prose above to the current file.)

---

## Part 5 — Trace the whole story end to end

Put it together as a single timeline, using only the real artifacts in this repo:

1. **Bug filed:** clicking "Start for free" while logged in → 404.
2. **Triage:** classified as Failure Mode 1 (`docs/recover/start-for-free-404/plan.md`).
3. **False lead surfaces and is killed:** the `proxy.ts`/`middleware.ts` claim, killed by
   a live `curl` test and a primary-source doc read (Part 3 above).
4. **Root cause confirmed:** `getCtaHref()` was correct; `app/dashboard/page.tsx` didn't
   exist (Part 2 above).
5. **Fix applied:** three one-line stub pages, ticket closed
   (`docs/recover/start-for-free-404/plan.md` → "Fix applied").
6. **Independent review, later:** `/project-review` re-examines the *same three files*
   against `ui-rules.md` and finds the stub too minimal — missing header, missing
   sign-out (`docs/project-review/placeholder-pages-header-signout/plan.md`).
7. **Second fix applied:** `ComingSoonCard`, `SignOutButton`, `Navbar` added to all three
   pages — without touching the original diagnosis or root-cause fix at all.

**Checkpoint:** Step 7 explicitly didn't change anything about step 4's diagnosis. Why
is that a sign the original fix was scoped correctly, rather than a sign it was wrong?
(Answer: the original diagnosis answered "why is this a 404," and that answer — a
missing page for a not-yet-built feature — remained true and useful. The review in step
6 answered a different question — "does this page meet the bar for a real page in this
app" — which is additive, not corrective. A genuinely wrong diagnosis would have required
*redoing* step 4, not just adding to step 7.)

---

## Self-check quiz

<details>
<summary><strong>1. What's the one-sentence test for distinguishing Failure Mode 1 from Failure Mode 2?</strong></summary>

Mode 1 is the first attempt at fixing an isolated symptom. Mode 2 requires *multiple
prior, stacked* fix attempts that made the situation progressively murkier or worse —
if there's no history of failed attempts compounding, it can't be Mode 2, regardless of
how broken the current symptom looks.
</details>

<details>
<summary><strong>2. The 404 in this incident and the missing Navbar/SignOutButton in the follow-up review were both "the same three files." Were they the same bug?</strong></summary>

No. The 404 was caused by the *route not existing at all* (no `page.tsx` for
`/dashboard`). The header/sign-out issue was a *completeness* gap in the stub that got
created to fix the 404 — the route existed and rendered, it just didn't meet the app's
own UI rules. Different root causes, different fixes, same files.
</details>

<details>
<summary><strong>3. Why was `curl -i http://localhost:3000/dashboard` while logged out enough to disprove the "proxy.ts never runs" claim?</strong></summary>

A `307` redirect to `/login` can only happen if some server-side logic intercepted the
request before the page rendered and decided "no valid session, redirect." `proxy.ts` is
the only code in this app that does that for `/dashboard`. If `proxy.ts` were truly
inert, the request would have fallen through to whatever the dashboard page itself
returns (at the time, a 404, or after the fix, an unprotected page render) — not a
redirect.
</details>

<details>
<summary><strong>4. What would have changed about the fix if `getCtaHref()` actually had a bug — say, it returned `/dashbord` (typo) instead of `/dashboard`?</strong></summary>

That would have been a Failure Mode 1 fix too (isolated, first attempt), but the fix
itself would target `lib/auth.ts` directly — correcting the string — rather than
creating new pages. The diagnosis explicitly ruled this out by reading the function and
confirming the redirect target matched the spec exactly, which is why the investigation
moved to "does the target page exist" instead.
</details>

<details>
<summary><strong>5. Why does a phased build plan (Phase 1 through Phase 5) inherently produce temporary 404s, and is that itself a bug?</strong></summary>

Any navigation element (a nav link, a CTA, a redirect) that points at a feature from a
later phase will 404 until that phase ships, simply because incremental builds wire up
references before every destination exists. It's not a bug in the sense of "wrong code"
— it's an expected, temporary state of an app under active multi-phase construction. The
real failure mode to watch for is *exposing* those forward references to real users
before the corresponding page (even a stub) exists — which is exactly what the fix in
Part 4 addressed.
</details>

---

## Extend it (challenges)

### Challenge 1 — Add a fourth placeholder

Feature "Settings" is Phase 6 and doesn't exist yet, but suppose `Navbar` needs a new
link to `/settings` today. Using `ComingSoonCard` and the existing three pages as your
template, write `app/settings/page.tsx` so that visiting `/settings` while logged in
shows a properly styled "coming soon" card with a working sign-out button — no 404, and
no UI-rules violations of the kind caught in Part 4.

<details>
<summary>Hint</summary>

Copy `app/dashboard/page.tsx` verbatim and change only the `title`/`description` props
and the function name. Don't reinvent `ComingSoonCard` or `SignOutButton` — reuse is the
whole point of the Part 4 fix.
</details>

### Challenge 2 — Predict the failure mode

Imagine three different bug reports against this same codebase. For each, decide which
Failure Mode (1, 2, or 3) it most likely is, and what single piece of evidence you'd
check first to confirm:

1. "I fixed the sign-out button three times now and it's somehow more broken each time —
   now clicking it does nothing at all, not even an error."
2. "The `/find-jobs` page shows a 404."
3. "Sign-out works, but afterward `getCtaHref()` still returns `/dashboard` instead of
   `/login`, even though the session cookie is gone."

<details>
<summary>Reveal reasoning</summary>

1. **Mode 2** — explicitly stated as the third attempt, with the symptom getting worse
   each time. The right move per the framework is to stop patching and revert to the
   last known-good state before re-diagnosing.
2. **Mode 1**, almost certainly the same shape as this tutorial's incident — check
   first whether `app/find-jobs/page.tsx` exists at all before suspecting any auth logic.
3. **Mode 3** — this isn't a missing page or a stacked-patch mess; it's a logic error in
   how "is there a session" is determined (`getCtaHref()` / `getCurrentUser()` not
   reflecting reality after sign-out). That's a misunderstanding of how the session check
   should work, which needs a real fix to the auth-reading logic, not a new page.
</details>

---

For deeper, open-ended exploration, `docs/recover/start-for-free-404/ai-discussion-topics.md`
has four prompts written for exactly this purpose — try answering each yourself first,
then compare with an AI's take.
