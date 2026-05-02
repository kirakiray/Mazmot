---
name: "punch-ui"
description: "Punch-UI component library knowledge base. Invoke when user asks about Punch-UI components, usage, theming, or developing new components based on ofa.js."
---

# Punch-UI Component Library

Punch-UI is a UI component library built on [ofa.js](https://github.com/ofajs/ofa.js), providing Web Components that can be used without build tools.

## Quick Start

### Install ofa.js

```html
<script
  src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.min.mjs"
  type="module"
></script>
```

### Import Global Styles

```html
<link
  rel="stylesheet"
  href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css"
/>
```

### Import Components

Use the `<l-m>` tag to import components:

```html
<!-- Button component -->
<l-m src="https://punch-ui-v2.pages.dev/packages/button/button.html"></l-m>

<!-- Input component -->
<l-m src="https://punch-ui-v2.pages.dev/packages/input/input.html"></l-m>

<!-- Switch component -->
<l-m src="https://punch-ui-v2.pages.dev/packages/switch/switch.html"></l-m>
```

## Available Components

- **Button** (`p-button`) - Button component with variants, sizes, and colors
- **Input** (`p-input`) - Text input field
- **Textarea** (`p-textarea`) - Multi-line text input
- **Switch** (`p-switch`) - Toggle switch
- **Checkbox** (`p-checkbox`) - Checkbox input
- **Radio** (`p-radio`) - Radio button input
- **Dialog** (`p-dialog`) - Modal dialog
- **List** (`p-list`, `p-list-item`) - List component
- **NavBar** (`p-nav-bar`, `p-nav-item`, `p-nav-layout`) - Navigation components
- **Snackbar** (`p-snackbar`) - Toast notifications
- **Ripple** (`p-ripple`) - Material Design ripple effect
- **Stylization** (`p-stylization`) - Styling wrapper component

## Component Usage Patterns

### Button Component

```html
<!-- Basic usage -->
<p-button>Click Me</p-button>

<!-- Variants -->
<p-button variant="filled">Filled</p-button>
<p-button variant="outlined">Outlined</p-button>
<p-button variant="text">Text</p-button>

<!-- Sizes -->
<p-button size="xs">Extra Small</p-button>
<p-button size="s">Small</p-button>
<p-button>Default</p-button>
<p-button size="l">Large</p-button>
<p-button size="xl">Extra Large</p-button>

<!-- Colors -->
<p-button color="primary">Primary</p-button>
<p-button color="error">Error</p-button>
<p-button color="success">Success</p-button>
<p-button color="neutral">Neutral</p-button>

<!-- Icon button -->
<p-button icon>+</p-button>

<!-- With slots -->
<p-button>
  <span slot="prefix">🔍</span>
  Search
</p-button>
```

### Input Component

```html
<p-input placeholder="Enter text"></p-input>
```

### Switch Component

```html
<p-switch></p-switch>
```

### Dialog Component

```html
<p-dialog id="myDialog">
  <h2>Dialog Title</h2>
  <p>Dialog content</p>
</p-dialog>

<script>
  const dialog = document.getElementById('myDialog');
  dialog.show(); // Open dialog
  dialog.close(); // Close dialog
</script>
```

## Theme System

Punch-UI supports light/dark theme switching using Material Design color system.

### Theme CSS Variables

The theme system uses CSS custom properties:

- Light mode: `.theme-light-mode`
- Dark mode: `.theme-dark-mode`

### Theme Colors

```css
/* Primary colors */
--md-sys-color-primary
--md-sys-color-on-primary
--md-sys-color-primary-container
--md-sys-color-on-primary-container

/* Success colors */
--md-sys-color-success
--md-sys-color-on-success
--md-sys-color-success-container
--md-sys-color-on-success-container

/* Error colors */
--md-sys-color-error
--md-sys-color-on-error
--md-sys-color-error-container
--md-sys-color-on-error-container

/* Neutral colors */
--md-sys-color-neutral
--md-sys-color-on-neutral
--md-sys-color-neutral-container
--md-sys-color-on-neutral-container

/* Surface colors */
--md-sys-color-surface
--md-sys-color-on-surface
```

### Switching Themes

```html
<!-- Light theme -->
<html class="theme-light-mode">
  ...
</html>

<!-- Dark theme -->
<html class="theme-dark-mode">
  ...
</html>
```

### Auto Theme Detection

By default, components follow the system theme preference.

## Creating New Components

### Component Structure

Each component is a single HTML file with the following structure:

```html
<template component>
  <!-- Import dependencies -->
  <l-m src="../dependency/dependency.html"></l-m>
  
  <!-- Styles -->
  <style>
    :host {
      /* Component styles */
    }
  </style>
  
  <!-- Template -->
  <div class="container">
    <slot></slot>
  </div>
  
  <!-- Script -->
  <script>
    import "../common/init.js";
    
    export default async ({ load }) => {
      // Load dependencies if needed
      if (!customElements.get("some-component")) {
        await load("../path/to/component.html");
      }
      
      return {
        tag: "p-component-name",
        attrs: {
          // Define attributes
          attr1: null,
          attr2: "default-value",
        },
        watch: {
          // Watch for attribute changes
          attr1(val) {
            // Handle change
          },
        },
        proto: {
          // Define methods
          method1() {
            // Method implementation
          },
        },
      };
    };
  </script>
</template>
```

### Component Naming Convention

- Tag name: `p-` prefix (e.g., `p-button`, `p-input`)
- File name: component name in lowercase (e.g., `button.html`, `input.html`)

### Best Practices

1. **Use Shadow DOM**: Components use Shadow DOM for style encapsulation
2. **Follow Material Design**: Use the theme CSS variables for colors
3. **Support Accessibility**: Include proper ARIA attributes and keyboard navigation
4. **Provide Slots**: Use slots for flexible content insertion
5. **Document Components**: Create a README.md for each component

### Component Properties

- `tag`: The custom element tag name
- `attrs`: Object defining component attributes
- `watch`: Object defining attribute watchers
- `proto`: Object defining prototype methods

## Development

### Local Development Server

```bash
npm run dev
```

This starts a local server at `http://localhost:5002`.

### File Structure

```
packages/
├── button/
│   ├── button.html      # Component definition
│   ├── group.html       # Button group component
│   ├── README.md        # Documentation
│   └── demo/
│       ├── index.html   # Basic demo
│       └── advanced.html # Advanced demo
├── input/
│   ├── input.html
│   └── README.md
├── css/
│   ├── pui-global.css   # Global styles
│   ├── theme.css        # Theme variables
│   └── palette.css      # Color palette
└── common/
    └── init.js          # Initialization script
```

## Common Patterns

### Attribute Binding

Use `attr:` prefix for attribute binding:

```html
<p-button attr:variant="isActive ? 'filled' : 'outlined'">
  Toggle Button
</p-button>
```

### Event Binding

Use `on:` prefix for event binding:

```html
<p-button on:click="handleClick">Click Me</p-button>
```

### Property Binding

Use `:` prefix for property binding:

```html
<p-input :value="inputValue"></p-input>
```

### Two-way Binding

Use `sync:` prefix for two-way binding:

```html
<p-input sync:value="inputValue"></p-input>
```

## Utility Functions

Punch-UI provides utility functions in `packages/util/`:

- `alert.js` - Alert dialog
- `confirm.js` - Confirmation dialog
- `prompt.js` - Prompt dialog
- `toast.js` - Toast notifications
- `dialog.js` - Dialog utilities

## CDN Links

Production CDN: `https://punch-ui-v2.pages.dev/`

Example:
```html
<l-m src="https://punch-ui-v2.pages.dev/packages/button/button.html"></l-m>
```

## Related Skills

- **ofajs-docs**: For ofa.js framework documentation and API reference

## Resources

- [GitHub Repository](https://github.com/kirakiray/Punch-UI)
- [ofa.js Documentation](https://ofajs.com/)
- [Live Demo](https://punch-ui-v2.pages.dev/demo/all-case.html)
