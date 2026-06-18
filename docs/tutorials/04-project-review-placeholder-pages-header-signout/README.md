# Tutorial 04 — Reviewing Placeholder Pages, Page Chrome, and Server Action Sign-Out

**After completing this tutorial you will understand:** how a narrow bug fix can still
leave product gaps, how `/project-review` checks a feature at three levels, why protected
placeholder pages still need the app's real navigation, how to wire sign-out with a
Server Action instead of client JavaScript, and how to decide when repeated markup should
become a shared component.

This tutorial is based on the real review artifacts in
[`docs/project-review/placeholder-pages-header-signout`](../../project-review/placeholder-pages-header-signout)
and the real code currently in this repo. Keep these files open while you work through it:

- [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx)
- [`app/profile/page.tsx`](../../../app/profile/page.tsx)
- [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx)
- [`components/layout/ComingSoonCard.tsx`](../../../components/layout/ComingSoonCard.tsx)
- [`components/layout/SignOutButton.tsx`](../../../components/layout/SignOutButton.tsx)
- [`app/actions/auth.ts`](../../../app/actions/auth.ts)
- [`app/api/auth/sign-out/route.ts`](../../../app/api/auth/sign-out/route.ts)

---

## How To Use An LLM Before This Tutorial

Before reading the review, use an LLM to practice separating "the symptom is gone" from
"the feature is product-ready." This tutorial is about review discipline as much as code.

Prompt 1:

```text
Teach me a three-layer code review model: plan alignment, system integrity, and
production readiness. Use a placeholder dashboard page as the example. Then ask me to
classify five findings by layer.
```

Prompt 2:

```text
Explain why a page that no longer returns 404 can still be incomplete.
Use navigation, empty states, and sign-out as examples. Ask me to find the user-flow
gap in each example.
```

Prompt 3:

```text
Teach me when repeated JSX should become a shared component.
Use three placeholder pages with the same card but different title text.
Ask me what props are healthy and what props would over-generalize the component.
```

Practice before continuing:

- List the difference between a route existing and a route being usable.
- Explain why protected placeholder pages still need navigation.
- Decide whether "sign out" is a logical CTA on an unfinished authenticated page.

---

## The Review Story

The earlier recovery work had one job: stop authenticated users from landing on 404s
after login. It did that by creating three placeholder routes:

```text
/dashboard
/profile
/find-jobs
```

That solved the narrow failure, but the review found a second class of problem: the
pages technically existed, yet they did not behave like real JobPilot pages. They were
missing the top navbar, they did not use the established empty-state card pattern, and
there was no in-app way for an authenticated user to sign out.

That is the point of a project review: it asks whether the code is aligned with the
system, not only whether the immediate error disappeared.

```
Original failure:
  /dashboard after login returned 404

Narrow recovery:
  Create placeholder page so /dashboard renders something

Project review:
  Does the placeholder still respect navigation, UI rules, and session control?

Final fix:
  Navbar + reusable coming-soon card + Server Action sign-out
```

**Checkpoint:** In one sentence, explain why "the page no longer 404s" is not the same
as "the page is acceptable for the product."

<details>
<summary>Reveal answer</summary>

A non-404 page can still violate the product's navigation model, visual system, and
basic user needs; in this case the user could reach a placeholder but lost the navbar
and had no way to sign out.

</details>

---

## 1. The Three-Layer Project Review Model

Open
[`docs/project-review/placeholder-pages-header-signout/plan.md`](../../project-review/placeholder-pages-header-signout/plan.md).
The review organized the findings into three layers:

| Layer | Question | What it caught here |
|---|---|---|
| Plan alignment | Did the implementation satisfy the intended route behavior? | The placeholders existed, but they omitted `Navbar`. |
| System integrity | Does it follow project architecture and UI rules? | The pages ignored the card and empty-state patterns. |
| Production readiness | Can a real user complete the surrounding workflow? | Signed-in users had no sign-out control. |

These layers are deliberately different. A test can pass Layer 1 while failing Layer 2
or Layer 3.

For example, this kind of placeholder would satisfy "avoid a 404":

```tsx
export default function DashboardPage() {
  return <main>Dashboard coming soon</main>;
}
```

But it fails the JobPilot system:

- No top navbar, even though `context/ui-rules.md` says all pages use the top navbar.
- No white bordered card, even though empty page sections use the card system.
- No user action, even though an authenticated user on an unfinished protected page
  needs an escape hatch.

**Try it yourself:** Before reading the next section, open the three placeholder page
files and list the two imports they now share. What do those imports tell you about the
review's final decision?

<details>
<summary>Reveal answer</summary>

They all import `Navbar` and `ComingSoonCard`. That shows the fix was page-level chrome
plus a shared empty-state component, not three unrelated one-off pages.

</details>

---

## 2. Page Chrome Is Not Owned by `app/layout.tsx`

A common assumption in App Router projects is that the root layout owns all shared
chrome. In this codebase, it does not. Open [`app/layout.tsx`](../../../app/layout.tsx)
and notice that it only owns the document shell:

```tsx
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased font-sans`}>
      <body className="min-h-full bg-background" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
```

There is no `<Navbar />` here. That means each page that needs the app header must render
it explicitly. The homepage already does this in [`app/page.tsx`](../../../app/page.tsx):

```tsx
export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Testimonial />
        <BottomCTA />
      </main>
      <Footer />
    </>
  );
}
```

The reviewed placeholder pages now follow the same page-level ownership pattern. Here is
the real dashboard placeholder:

```tsx
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

The key detail is `min-h-[calc(100vh-4rem)]`. The navbar height is `h-16`, which is
4rem. The main area subtracts that height so the card centers in the remaining viewport,
not behind or including the header.

**Checkpoint:** Why did the fix add `<Navbar />` to each placeholder page instead of
putting `<Navbar />` in `app/layout.tsx`?

<details>
<summary>Reveal answer</summary>

Because the existing app architecture makes pages responsible for their own header and
footer. Changing `app/layout.tsx` would affect every route globally and would be a larger
architecture change than the review required.

</details>

**Modify this mentally:** If you later build the real `/profile` page, should you keep
`ComingSoonCard` and add the profile form under it, or replace the placeholder page
entirely?

<details>
<summary>Reveal answer</summary>

Replace it entirely. `context/progress-tracker.md` explicitly says the placeholder pages
are throwaway stubs and should be replaced when the real feature starts.

</details>

---

## 3. Reading the Empty-State Card

Open [`components/layout/ComingSoonCard.tsx`](../../../components/layout/ComingSoonCard.tsx):

```tsx
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

This component is small, but it encodes several project rules:

| Code | Rule it satisfies |
|---|---|
| `bg-surface` | Cards use the surface token, not hardcoded white or raw Tailwind colors. |
| `border border-border` | Borders use the project token. |
| `rounded-2xl p-6 shadow-lg` | Matches the card pattern recorded in `context/ui-registry.md`. |
| `text-text-primary` | Primary copy uses semantic text tokens. |
| `text-text-muted` | Empty-state descriptions use muted text. |
| `<SignOutButton />` | Empty states include a CTA when there is a logical next action. |

The component accepts only `title` and `description`. It does not accept arbitrary
children, class overrides, or custom actions. That is intentional. The three placeholder
pages are supposed to look identical while they are temporary.

**Checkpoint:** Why is `SignOutButton` inside `ComingSoonCard` instead of repeated in
all three page files?

<details>
<summary>Reveal answer</summary>

All three pages use the exact same empty-state action. Keeping it inside the shared card
means a future tweak to the placeholder action requires one edit, not three.

</details>

**Try it yourself:** Open all three placeholder pages and compare their JSX. The only
differences should be the route component name, `title`, and `description`. If you find
another difference, ask whether it is intentional or drift.

---

## 4. Why Three Copies Became One Component

The review explanation calls out a practical threshold: three near-identical usages is
enough duplication to justify a shared component.

This does not mean "always abstract after three copies." It means the abstraction is
reasonable when these conditions are true:

- The markup is structurally identical.
- The styling should remain identical.
- The differences are simple data, not behavior.
- Future changes should apply to all copies together.

`ComingSoonCard` meets all four:

```tsx
<ComingSoonCard
  title="Find Jobs"
  description="Find Jobs is next after the foundation auth flow is complete."
/>
```

The page supplies content. The component owns presentation and the shared sign-out CTA.

An abstraction would be weaker if each page needed different layout, different buttons,
or route-specific behavior. Then a shared component would either grow too many props or
hide important differences.

**Checkpoint:** Which prop would be a warning sign that `ComingSoonCard` is becoming too
generic?

<details>
<summary>Reveal answer</summary>

Props like `buttonVariant`, `showSignOut`, `extraClassName`, or `footerSlot` would be
warning signs. They suggest the component is no longer one clear placeholder pattern and
is becoming a generic card framework.

</details>

---

## 5. Server Action Sign-Out

Open [`app/actions/auth.ts`](../../../app/actions/auth.ts). The sign-in functions and
sign-out function live in the same Server Action file:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthActions } from "@insforge/sdk/ssr";

export async function signOut() {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  await auth.signOut();
  redirect("/");
}
```

This shape matches the existing OAuth actions:

1. Run on the server because the file starts with `"use server"`.
2. Read the request cookie store with `await cookies()`.
3. Create InsForge auth actions with `createAuthActions`.
4. Mutate the session server-side.
5. Redirect as part of the server response.

The UI for this action is plain HTML form submission. Open
[`components/layout/SignOutButton.tsx`](../../../components/layout/SignOutButton.tsx):

```tsx
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

There is no `"use client"`, no `useRouter`, no `fetch`, and no loading state. That is
the point. Signing out is a session mutation that can happen entirely through a server
form action.

The browser submits the form. Next.js invokes `signOut()` on the server. InsForge clears
the auth cookies in the response. `redirect("/")` sends the user back to the homepage.

```
Click Sign out
  ↓
Native form POST
  ↓
app/actions/auth.ts signOut()
  ↓
InsForge clears session cookies
  ↓
Next.js redirect("/")
  ↓
Homepage renders logged-out state
```

**Checkpoint:** What would change if `SignOutButton` used `onClick` and `fetch()`?

<details>
<summary>Reveal answer</summary>

The component would need `"use client"`, a browser-side click handler, manual fetch
error handling, and manual navigation after success. The current form action avoids all
of that and keeps the component server-rendered.

</details>

---

## 6. Why the Existing Route Handler Stayed

There is also a fetchable sign-out endpoint:
[`app/api/auth/sign-out/route.ts`](../../../app/api/auth/sign-out/route.ts).

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const auth = createAuthActions({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  const { error } = await auth.signOut();
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.statusCode });
  }

  return response;
}
```

The review did not delete this endpoint. That is a useful design distinction:

| Surface | Best for | Current use |
|---|---|---|
| Server Action | UI forms, progressive enhancement, direct redirect flow | `SignOutButton` |
| Route Handler | Programmatic callers that need JSON | Available for future client-side flows |

Keeping the route handler is acceptable because it is a valid public API surface for a
different kind of caller. It would become suspicious if the project accumulated many
unused endpoints with no plausible caller or no tests.

**Checkpoint:** Is `app/api/auth/sign-out/route.ts` dead code just because
`SignOutButton` does not call it?

<details>
<summary>Reveal answer</summary>

Not necessarily. It is unused by the current UI, but it still represents a fetchable
auth endpoint that could serve future client-side flows. Dead code depends on whether
the endpoint has a justified role, not only whether today's component imports it.

</details>

---

## 7. Styling Review: Token-Based, Not Color-Based

The project has a strict styling rule: do not use hardcoded hex values or raw Tailwind
color classes in components. The new components follow that rule.

Study the button classes:

```tsx
className="bg-surface border border-border text-text-primary text-sm font-medium px-4 py-2 rounded-md hover:bg-surface-secondary transition-colors"
```

Every color is semantic:

| Class | Meaning |
|---|---|
| `bg-surface` | White surface background from project tokens. |
| `border-border` | Default project border token. |
| `text-text-primary` | Main readable text token. |
| `hover:bg-surface-secondary` | Subtle hover surface token. |

This is preferred over:

```tsx
className="bg-white border border-gray-200 text-gray-900 hover:bg-gray-50"
```

The second version may look similar today, but it breaks the design system. If the
tokens change, token-based components update automatically; raw colors do not.

**Try it yourself:** In your editor, search inside `components/layout/ComingSoonCard.tsx`
and `components/layout/SignOutButton.tsx` for `gray`, `white`, `purple`, or `#`. You
should find none in class names.

---

## 8. Verification Path

The review recorded this verification:

```text
npx tsc --noEmit
curl to /dashboard while logged out -> 307 redirect to /login
```

Those checks cover different risks:

| Check | What it proves | What it does not prove |
|---|---|---|
| `npx tsc --noEmit` | The new components and Server Action type-check. | The browser UX works visually. |
| Logged-out `curl` redirect | Protected route gating still works. | Authenticated view, navbar rendering, and sign-out behavior. |
| Manual browser session | Header, card, and sign-out work together. | Full future dashboard/profile/jobs features. |

Because auth requires real Google/GitHub session state, the final visual confirmation is
manual: sign in, visit `/dashboard`, confirm the navbar and card render, click
`Sign out`, and confirm you land on `/`.

**Checkpoint:** Why is `curl /dashboard` while logged out still an important test even
though this tutorial is mostly about UI?

<details>
<summary>Reveal answer</summary>

Because adding placeholder pages should not weaken route protection. The logged-out
redirect proves `proxy.ts` still gates protected routes before the page renders.

</details>

---

## 9. End-to-End Mental Trace

Use this trace to connect all the pieces:

```
User signs in successfully
  ↓
OAuth callback redirects to /dashboard
  ↓
proxy.ts allows request because session exists
  ↓
app/dashboard/page.tsx renders
  ↓
Navbar renders navigation and auth-aware CTA
  ↓
main centers ComingSoonCard in remaining viewport
  ↓
ComingSoonCard renders title, muted description, SignOutButton
  ↓
SignOutButton submits Server Action form
  ↓
signOut() clears InsForge session and redirects home
```

Now compare that with the broken mental trace:

```
User signs in successfully
  ↓
OAuth callback redirects to /dashboard
  ↓
Page technically exists
  ↓
No navbar
  ↓
No sign out
  ↓
User is stranded in an unfinished protected page
```

That difference is exactly what the project review caught.

---

## 10. Self-Check Quiz

Answer these before expanding the answers.

**1. What was the original narrow problem, and what broader problem did review catch?**

<details>
<summary>Reveal answer</summary>

The narrow problem was protected routes returning 404 after auth. The broader problem
was that the new placeholder pages did not follow page chrome, empty-state, and sign-out
expectations for real authenticated users.

</details>

**2. Why is `Navbar` imported in each placeholder page?**

<details>
<summary>Reveal answer</summary>

Because `app/layout.tsx` is only the document shell in this project. The established
page pattern is for each page to render its own `Navbar` and, when needed, `Footer`.

</details>

**3. Why does `SignOutButton` not need `"use client"`?**

<details>
<summary>Reveal answer</summary>

It uses a native form action wired to a Server Action. There is no client state, browser
API, event listener, or client-only library.

</details>

**4. Why was `ComingSoonCard` worth extracting?**

<details>
<summary>Reveal answer</summary>

Three pages needed the same markup, styling, and action with only title/description
changes. A shared component keeps the temporary empty-state pattern consistent.

</details>

**5. What risk would be introduced by replacing the Server Action sign-out with a client
fetch call?**

<details>
<summary>Reveal answer</summary>

It would add a Client Component boundary, browser JavaScript, manual error handling, and
manual navigation for a workflow that can be handled by the server response directly.

</details>

---

## 11. Practice Exercises

### Exercise A — Review a Placeholder

Pretend a new placeholder route is added at `/analytics`:

```tsx
export default function AnalyticsPage() {
  return <p>Analytics coming soon</p>;
}
```

Review it using the same three layers:

- Plan alignment: does it render the route?
- System integrity: does it use the app's page chrome and UI patterns?
- Production readiness: can an authenticated user recover or navigate?

Write the corrected version before checking the existing `/dashboard` page for the
pattern.

### Exercise B — Trace the Sign-Out Flow

Without looking back, write the five-step flow from clicking `Sign out` to landing on
the homepage. Include which file runs the session mutation.

### Exercise C — Identify Over-Abstraction

Imagine someone changes `ComingSoonCard` to this API:

```tsx
<ComingSoonCard
  title="Dashboard"
  description="Dashboard is next."
  showSignOut
  variant="large"
  shadow="lg"
  align="center"
/>
```

Which props are harmless, and which suggest the component is turning into a generic
layout system? Explain your answer.

### Exercise D — Add a Manual Verification Checklist

Write a checklist for manually testing these pages after logging in:

- `/dashboard`
- `/profile`
- `/find-jobs`

Include navbar visibility, card content, and sign-out behavior.

---

## What You Should Take Away

Project review is not only a bug hunt. In this example, the code already "worked" in the
narrow sense that the routes rendered. The review improved the feature by checking
whether those routes fit the app's architecture, UI system, and real user flow.

The final implementation is intentionally small:

- Pages own their navbar because this project keeps root layout minimal.
- Placeholder content lives in one shared `ComingSoonCard`.
- Sign-out uses the same Server Action pattern as sign-in.
- Styling uses semantic tokens instead of raw colors.

That is the standard to carry into future placeholder or transitional features: they can
be temporary, but they still need to behave like part of the product.
