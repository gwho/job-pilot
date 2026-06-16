# Explanation — Placeholder Pages Header + Sign Out

## Why the missing header counted as an issue, not a style nitpick

`ui-rules.md` states: *"All pages use top navbar only — no sidebar, no drawer."* That's an absolute rule about every page in the app, not a homepage-specific one. The placeholder pages are still pages a real (or testing) user lands on — when they're missing the navbar, the user loses every navigation affordance (logo-as-home-link, Dashboard/Find Jobs/Profile links, the auth-aware CTA) the moment they hit an unfinished route. The fix isn't cosmetic: it restores the one navigation mechanism the whole app relies on, on routes that otherwise have none.

## Why this was caught by `/project-review` and not earlier

The original `/recover` session was scoped narrowly: stop a 404. A 404 is binary — it either resolves or it doesn't — so "renders a 200 with some text" satisfied that specific, narrow goal. What it didn't do is ask "does this match the established page-level conventions of the rest of the app?" That's a different kind of check — comparing against `ui-rules.md` and the design system, not against an error code. `/project-review`'s three-layer structure (plan alignment, system integrity, production readiness) exists specifically to catch this gap: Layer 1 alone (does the 404 still happen?) would have passed; Layer 2 (does it respect the system?) is what surfaced the missing header and missing card pattern.

## Why a Server Action for sign-out instead of calling the existing JSON route from client JS

`app/api/auth/sign-out/route.ts` already existed and works, but using it from the UI would require a Client Component with `"use client"`, a `fetch()` call, manual error handling, and a manual `router.push("/")` after the response resolves — several moving parts for what is, structurally, identical to how `signInWithGoogle`/`signInWithGithub` already work. Both of those are plain Server Actions invoked via `<form action={...}>` with zero client JavaScript: the browser submits a real form post, Next.js routes it to the function, and `redirect()` handles navigation as part of the same server response. Reusing that exact shape for sign-out keeps one consistent auth-action pattern in the codebase instead of two (forms for sign-in, fetch+state for sign-out), and it was a smaller diff. The Route Handler wasn't deleted — it's still there for any future client-side caller (e.g., a settings page with already-mounted client interactivity) that genuinely needs a fetchable endpoint instead of a form post.

## Why a shared `ComingSoonCard` instead of writing the markup three times

Three near-identical usages is the threshold where extracting a component stops being premature abstraction and starts being the more honest representation of what's actually happening: three pages doing exactly the same thing with two different strings (title, description). Inlining the same ~10 lines of JSX three times would mean any future tweak to the empty-state pattern (spacing, the sign-out button's position, adding an icon per `ui-rules.md`'s "optional icon above text") needs three coordinated edits instead of one. Because all three pages are explicitly throwaway (replaced wholesale when Features 05/09/14 land), the component itself is also throwaway — it's not over-engineering, it's just not copy-pasting in the meantime.

## Why no `<Footer />` was added

The screenshot the user provided shows only a header and a centered card — no footer visible. `ui-rules.md`'s Empty States section asks for "short descriptive text... optional icon... CTA button" — nothing about a footer, and the homepage's footer (logo + copyright) doesn't carry information relevant to an auth-gated, mid-construction page. Adding it would be scope creep beyond what was asked and beyond what the empty-state rule calls for.
