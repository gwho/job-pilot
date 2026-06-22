# Fix Explanation — Tailwind v4 Performance Reference

## Context

This project uses Tailwind CSS v4. Tokens live in CSS via `@theme`, and Tailwind is imported with:

```css
@import "tailwindcss";
```

The performance reference is used by agents when optimizing or documenting CSS behavior, so its examples need to match Tailwind v4.

## The gap

The file still included configuration from older Tailwind versions:

- manual `content` globs in `tailwind.config.js`;
- `jit: true`, even though JIT is built into v4;
- `purge` configuration;
- manual PostCSS plugin wiring.

Those examples made performance look like a JavaScript config concern instead of a CSS-first v4 concern.

## The fix

The examples now show CSS-first configuration:

```css
@import "tailwindcss";

@source "../packages/ui";

@theme {
  --color-brand: oklch(0.62 0.18 260);
}
```

`@source` is presented as an exception mechanism for external packages or dynamic class safelists, not as the default way to scan the app.

## Behavior after the fix

Agents reading the reference should now:

- rely on v4 automatic source detection by default;
- add `@source` only for content outside automatic detection;
- define tokens in `@theme`;
- avoid adding legacy `content`, `jit`, `purge`, or PostCSS plugin examples.

## Verification

The file was searched for obsolete patterns after editing, and only an explanatory sentence about avoiding legacy PostCSS wiring remained.
