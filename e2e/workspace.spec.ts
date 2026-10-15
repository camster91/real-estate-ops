import { expect, test } from "@playwright/test";

test("pending workspace is readable and keyboard accessible", async ({
	page,
}, testInfo) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"A shared workspace for your real estate team.",
	);
	await expect(
		page.getByRole("complementary", { name: "Workspace status" }),
	).toContainText("Access pending");
	await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("link", { name: "Skip to content" }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("main")).toBeFocused();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("workspace.png"),
		fullPage: true,
	});
});
