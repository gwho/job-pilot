# AI Discussion Topics — Placeholder Pages Header + Sign Out

1. "Why did `/recover`'s narrow fix (stop the 404) pass its own goal but still leave a real gap? What does that say about scoping a fix too narrowly?"
2. "Walk through exactly what happens, network-request by network-request, when a plain `<form action={signOutServerAction}>` is submitted — no client JavaScript involved. How is this different from a `fetch()` call to a Route Handler?"
3. "Three usages of the same markup triggered extracting `ComingSoonCard` into a component. Is three really the right threshold, or is that just a convention? What would change the answer?"
4. "The `app/api/auth/sign-out/route.ts` Route Handler still exists but isn't called by anything right now. Is that dead code, or justified? How would you tell the difference in a real codebase?"
5. "`ui-rules.md`'s 'Empty States' rule asks for a CTA 'if there's a logical next action.' Why is 'sign out' a logical next action for an authenticated user looking at an unbuilt page, specifically?"
