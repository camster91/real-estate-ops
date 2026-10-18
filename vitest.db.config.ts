import { defineConfig } from "vitest/config";

// Database tests need a real PostgreSQL; see docs/platform/LOCAL_DEVELOPMENT.md.
export default defineConfig({
	test: {
		include: ["packages/**/*.db.test.ts"],
		exclude: ["**/node_modules/**"],
		testTimeout: 30000,
		hookTimeout: 30000,
	},
});
