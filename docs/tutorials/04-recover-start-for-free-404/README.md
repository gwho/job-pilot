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

<details>
<summary>Reveal answer</summary>

Mode 3 is about a *misunderstood requirement* — code that does the wrong thing on purpose
because someone misread the spec. Here the spec said "redirect to `/dashboard` when logged
in," and the code did exactly that. The thing that didn't exist was the page on the other
end of that redirect — a missing *implementation*, not a wrong *design*. Fixing Mode 3
requires rethinking the approach; fixing a missing page requires adding a file.

</details>

**Checkpoint:** This 404 had no error stack trace — just "page could not be found." What
specific signs pointed toward Mode 1 rather than Mode 3 in a symptom that gives you no
stack trace to read?

<details>
<summary>Reveal answer</summary>

Without a stack trace, classification comes from two things:

**Scope check:** Everything else worked — the homepage rendered, auth succeeded, `getCtaHref()` ran and returned a string. The problem was isolated to one broken destination, not a systemic breakdown. Mode 2 requires stacked failed attempts (there were none); Mode 3 requires a wrong design decision (the redirect logic was correct by the spec).

**Code read:** `getCtaHref()` was readable and obviously correct — `data.user ? "/dashboard" : "/login"` matches the spec exactly. The only open question was "does `/dashboard` exist" — a factual question with a one-file answer.

When a symptom has no stack trace, the classification falls back to: does the code do what it was supposed to do? If yes and the problem is isolated, Mode 1. If yes but the surrounding system doesn't exist yet, Mode 1 with a forward-reference cause.

</details>

**Checkpoint:** What's the one-sentence test for distinguishing Mode 1 from Mode 2, without any other information about the bug?

<details>
<summary>Reveal answer</summary>

Mode 1 is the first attempt at fixing an isolated symptom. Mode 2 requires *multiple
prior, stacked* fix attempts that made the situation progressively murkier or worse — if
there's no history of failed attempts compounding, it can't be Mode 2, regardless of how
broken the current symptom looks.

</details>

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

**Checkpoint:** Why does a phased build plan inherently create temporary 404s? What's
the general strategy for handling routes that point at not-yet-built features without it
looking like a bug to users?

<details>
<summary>Reveal answer</summary>

Any navigation element — a nav link, a CTA, a redirect — that points at a feature from a
later phase will 404 until that phase ships, because incremental builds wire up references
before every destination exists. The moment you write `getCtaHref()` returning
`"/dashboard"` in Phase 1, you've created a forward reference to Phase 5.

The general strategy is a **stub page**: a minimal `page.tsx` that renders something
meaningful (not just a 404) so the route resolves. The stub signals "this exists but isn't
built yet" instead of "this is broken." As Part 4 covers, even stubs have quality bars —
a blank render is better than a 404, but a render with your design system and a sign-out
button is better still.

</details>

**Checkpoint:** The diagnosis explicitly says "this is not a bug in the auth logic." What
would change about the fix if it *had* been a bug in `getCtaHref()` — say, it returned
`"/dashbord"` (typo) instead of `"/dashboard"`?

<details>
<summary>Reveal answer</summary>

The fix would target `lib/auth.ts` directly — correcting the string — rather than
creating a new page. The *symptom* (404) would look identical, but the root cause is now
the *function*, not the *destination*. This is still a Failure Mode 1 fix (isolated,
first attempt, targeted change), but the file that changes is different.

The diagnosis step that distinguishes them: reading `getCtaHref()` and confirming the
redirect target matches the spec exactly. If the function returns `"/dashbord"` and the
spec says `"/dashboard"`, fix the function. If the function is correct and the page
doesn't exist, create the page. The function was read and confirmed correct — which
moved the investigation to "does the target page exist."

</details>

**Try it yourself:** If you were building a 10-phase app and Phase 1 already linked to
`/settings`, `/billing`, and `/team` — none of which exist yet — open `getCtaHref()` in
`lib/auth.ts` and think through: would adding stubs for those routes be Failure Mode 1
each time, or would it be Mode 3? What's the deciding factor?

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

**Checkpoint:** What specifically made the `proxy.ts` claim falsifiable, and why is
"falsifiable and cheap to check" a useful bar for deciding whether to verify a claim
before acting on it?

<details>
<summary>Reveal answer</summary>

The claim was **specific** and **made a testable prediction**: "`proxy.ts` never runs."
If it never runs, then an unauthenticated request to a protected route would pass through
to the page — not redirect to `/login`. That prediction is checkable in one `curl`
command.

"Falsifiable and cheap to check" matters because not every claim is worth verifying.
A vague claim ("the auth might be slow") or an expensive-to-test one ("this fails only
under concurrent load") reasonably gets provisional trust. But when a claim is specific
enough to make a concrete prediction AND the cost of checking it is one command, the
cost of *not* checking it is higher — you risk building an incorrect fix on a wrong
premise. Here the test took 3 seconds and instantly ruled out an entire investigation
branch.

</details>

**Checkpoint:** The claim was falsified twice — by a live `curl` test AND by a file read
from `node_modules`. Why does using two independent methods matter, rather than stopping
after the first confirms what you expected?

<details>
<summary>Reveal answer</summary>

Two independent methods reaching the same conclusion means the result isn't an artifact
of one method's assumptions. The `curl` test could theoretically be misread (maybe the
307 came from somewhere else). The `node_modules` doc could theoretically be stale. But
both reaching the same conclusion via entirely different paths — runtime behavior and
source documentation — makes it very unlikely both are wrong in the same direction. This
is the same principle as running both a test suite and a manual check: agreement between
independent sources is stronger evidence than either alone.

</details>

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
during the original bug fix itself?

<details>
<summary>Reveal answer</summary>

From `docs/recover/start-for-free-404/explanation.md`: "a fix focused on 'did the error
go away' will not, by itself, ask 'does this match the rest of the system.' Both checks
matter, but they're different checks, run at different times, for good reason — conflating
them risks under-scoping the original fix while debugging is still in progress."

While mid-diagnosis trying to stop a 404, that's the wrong moment to also audit
design-system compliance — finish stopping the bleeding first, then review with fresh
eyes. The two questions have different scopes, different reference material (the symptom
vs. the design rules), and are best answered sequentially rather than simultaneously.

</details>

**Checkpoint:** The 404 and the missing Navbar/SignOutButton were both in the same three
files. Were they the same bug?

<details>
<summary>Reveal answer</summary>

No. The 404 was caused by the *route not existing at all* — no `page.tsx` for
`/dashboard`. The header/sign-out issue was a *completeness* gap in the stub that got
created to fix the 404. The route existed and rendered; it just didn't meet the app's own
UI rules. Different root causes, different fixes, same files.

This matters because it shows that "fixed" has at least two meanings in practice: "the
reported symptom is gone" and "the system meets its own standards." The first fix
addressed the first meaning. The project review addressed the second. Both are necessary;
neither can substitute for the other.

</details>

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

<details>
<summary>Reveal answer</summary>

The original diagnosis answered "why is this a 404," and that answer — a missing page for
a not-yet-built feature — remained true and useful. The review in step 6 answered a
different question — "does this page meet the bar for a real page in this app" — which is
additive, not corrective. A genuinely wrong diagnosis would have required *redoing* step
4, not just adding to step 7. Step 7 built on step 4 without contradicting it. That's
the signal: when a second fix is additive rather than corrective, the first fix was right
about what it claimed to fix.

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

For deeper exploration, `docs/recover/start-for-free-404/ai-discussion-topics.md` has
four prompts covering failure-mode classification, falsifiable claims, phased-build 404s,
and the difference between "auth bug" and "missing page." Feed them to an LLM *after*
forming your own answer first — the gap between what you thought and what you learn is
where understanding lands.
