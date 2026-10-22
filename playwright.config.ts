import { defineConfig } from "@playwright/test";

const testBrowser = process.env.REO_TEST_BROWSER_EXECUTABLE;
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	use: {
		baseURL: "http://127.0.0.1:3000",
		headless: true,
		launchOptions: testBrowser ? { executablePath: testBrowser } : {},
	},
	webServer: {
		// The website imports @reo/domain from its build output.
		command: "pnpm --filter @reo/domain build && pnpm --filter @reo/web dev",
		url: "http://127.0.0.1:3000",
		reuseExistingServer: false,
		timeout: 60000,
	},
	projects: [
		{ name: "mobile", use: { viewport: { width: 390, height: 844 } } },
		{ name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
		{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
	],
});
