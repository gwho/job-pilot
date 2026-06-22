# Tailwind CSS Performance Optimization

## Bundle Size Optimization

Configure content sources for optimal tree-shaking:

```javascript
// tailwind.config.js (v4+)
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,vue,svelte}",
    "./node_modules/@mycompany/ui-lib/**/*.{js,ts,jsx,tsx}",
  ],
  // Note: JIT is always enabled in v4+, no configuration needed
}
```

### Content Path Best Practices

1. **Be specific**: Don't use `"./**/*"` - it scans too many files
2. **Include UI libraries**: Add paths to component libraries
3. **Exclude tests**: Don't include test files in content paths

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
  --color-brand: #3b82f6;
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

### Content Configuration (v4)

In Tailwind v4, use `content` property (not `purge`):

```javascript
// tailwind.config.js
export default {
  content: [
    './src/**/*.html',
    './src/**/*.jsx',
    './src/**/*.tsx',
  ],
}
```

### Minification

```bash
# Use cssnano for minification
npm install -D cssnano
```

```javascript
// postcss.config.mjs (ES module syntax for v4)
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
    ...(process.env.NODE_ENV === 'production' ? { cssnano: {} } : {}),
  },
}
```

---

## Best Practices for Performance

1. **JIT is automatic in v4**: Always enabled, no configuration needed
2. **Configure content correctly**: Only include files that use Tailwind
3. **Minimize custom CSS**: Use Tailwind utilities over custom CSS
4. **Tree-shaking is automatic**: v4 removes unused styles in production builds
5. **Use `@layer` for custom styles**: Helps with organization and tree-shaking
6. **Avoid `@apply` in components**: Prefer composing utilities in markup
