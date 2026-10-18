import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
		exclude: ["**/*.db.test.ts", "**/node_modules/**"],
	},
});
