# AI Discussion Topics — Auth Sign-Out Error Handling

Use these prompts for deeper review:

1. Explain why auth mutation failures should stop success-side effects like analytics capture.
2. Compare returning `{ success: false }` from a Server Action with using `redirect()` for navigation actions.
3. Review whether `/login?error=signout` should render a user-facing message like the OAuth error state.
4. Walk through why proxy auth gates should trust `updateSession()`'s returned session state instead of stale request cookies.
