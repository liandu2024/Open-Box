# Development board deployment

After completing any application code or style change, run `corepack pnpm run deploy:devboard` before responding. This builds the project, (re)starts the local dev-board server if needed, and verifies that `http://127.0.0.1:2048` serves the newly built entry asset. Report the deployment result to the user.

# UI consistency

Before changing any UI, find and reuse existing components, styles, and interaction patterns for the same purpose. Keep list rows, switches, spacing, buttons, and dialogs consistent across the application; do not introduce another visual pattern when an existing one fits. Use `DnsRewriteCard.vue` as the reference for simple DNS settings lists and `DialogWrapper.vue` for dialogs.

Use the existing `showNotification` helper for operation feedback in the global top-right notification area; do not add a separate inline success/error banner or duplicate notifications between parent and child components. Expand/collapse controls use the existing chevron pattern: down when collapsed (click to expand), up when expanded (click to collapse).

Use `components/common/AppPagination.vue` for paginated lists. It defaults to 20 rows, supports 50/100/custom sizes, exposes `v-model:page` and `v-model:page-size`, and emits one `change` event per user action. Supply the total and loading state; the data source should return the effective page and page size after clamping to valid bounds.
