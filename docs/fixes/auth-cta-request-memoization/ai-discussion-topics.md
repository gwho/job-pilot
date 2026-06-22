# AI Discussion Topics — CTA Auth Request Memoization

1. Explain why React's `cache()` is scoped to a single server request, not the process lifetime.
2. Compare `cache()` with `unstable_cache()` — when would you use each in a Next.js App Router project?
3. Walk through what happens when `getCachedCtaHref()` is called three times within the same render: which call hits InsForge and which return memoized values?
4. Review whether `getCtaHref()` should also be memoized in other contexts where authenticated user state is needed on the same page.
