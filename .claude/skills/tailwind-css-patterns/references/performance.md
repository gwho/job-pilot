# Tailwind CSS Performance Optimization

## Bundle Size Optimization

Tailwind v4 automatically detects template files with the Oxide engine. Use CSS-first `@source` directives only for files Tailwind would not otherwise scan, such as external component libraries:

```css
/* app.css */
@import "tailwindcss";

@source "../node_modules/@mycompany/ui-lib";

@theme {
  --color-brand: oklch(0.62 0.18 260);
  --font-mono: "Fira Code", monospace;
}
```

### Source Detection Best Practices

1. **Rely on auto-detection**: Tailwind v4 discovers project templates without a `content` array
2. **Add external sources explicitly**: Use `@source` for component libraries outside the app source tree
3. **Keep sources narrow**: Point `@source` at the package or directory that actually contains classes

---

## CSS Optimization Techniques

```html
<!-- Use content-visibility for offscreen content -->
<div class="content-visibility-auto">
  <div>Heavy content that's initially offscreen</div>
</div>

<!-- Optimize images with aspect-ratio -->
<img class="aspect-video w-full object-cover" src="video.jpg" alt="Video thumbnail" />

<!-- Use contain for paint optimization -->
<div class="contain-layout">
  Complex layout that doesn't affect outside elements
</div>
```

---

## Development Performance (v4.1+)

```css
/* Enable CSS-first configuration in v4.1 */
@import "tailwindcss";

@theme {
  /* Define once, use everywhere */
  --color-brand: oklch(0.62 0.18 260);
  --font-mono: "Fira Code", monospace;
}

/* Critical CSS for above-the-fold content */
@layer critical {
  .hero-title {
    @apply text-4xl md:text-6xl font-bold;
  }
}
```

---

## Production Build Optimization

### Source Detection and Safelisting

```css
/* app.css */
@import "tailwindcss";

/* Optional: scan additional files that v4 auto-detection cannot see. */
@source "../packages/ui";

/* Optional: include dynamic classes that do not appear literally in templates. */
@source inline("bg-brand text-center");

@theme {
  --color-brand: oklch(0.62 0.18 260);
}
```

### Minification

```css
/* app.css */
@import "tailwindcss";

@theme {
  --spacing-card: 1.5rem;
}
```

Tailwind v4 production builds are optimized by the Tailwind CLI or framework integration. Avoid adding legacy `tailwindcss` and `autoprefixer` PostCSS plugin wiring unless a v3 project still requires it.

---

## Best Practices for Performance

1. **Use v4 auto-detection**: JIT is built in and template discovery is automatic
2. **Add `@source` only when needed**: Include external packages or dynamic class safelists explicitly
3. **Minimize custom CSS**: Use Tailwind utilities over custom CSS
4. **Keep CSS-first configuration close to the app**: Define tokens with `@theme`
5. **Use `@layer` for custom styles**: Helps with organization
6. **Avoid `@apply` in components**: Prefer composing utilities in markup
