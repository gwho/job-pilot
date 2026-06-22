---
title: Never Modify Design Tokens
impact: CRITICAL
impactDescription: Token changes affect entire application
tags: tokens, design-tokens, tailwind-config, modification, forbidden
---

## Never Modify Design Tokens

Never modify the design tokens in the `@theme` directive in `app/globals.css` without explicit approval.

**Why this matters:**

- Token changes affect the entire application
- Unauthorized changes break visual consistency
- Token modifications require design review

**Incorrect (modifying tokens):**

```css
/* DON'T: Adding new colors to @theme in globals.css */
@theme {
  --color-my-new-color: #FF5500; /* FORBIDDEN */

  /* DON'T: Adding new spacing values */
  --spacing-13: 3.25rem; /* FORBIDDEN */
}
```

**Correct (requesting token changes):**

If a new token is needed:

1. Escalate to the design team
2. Document the use case and rationale
3. Use existing tokens that are closest to the requirement until approved
4. Wait for the new token to be added through proper channels

**Protected files:**

- `app/globals.css` (specifically the `@theme` directive block)
