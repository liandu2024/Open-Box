# Development board deployment

After completing any application code or style change, run `corepack pnpm run deploy:devboard` before responding. This builds the project, (re)starts the local dev-board server if needed, and verifies that `http://127.0.0.1:2048` serves the newly built entry asset. Report the deployment result to the user.
