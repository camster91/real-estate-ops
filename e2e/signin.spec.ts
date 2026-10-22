import { expect, test } from "@playwright/test";
import {
	expectFocusRing,
	expectNoHorizontalScroll,
	MEMBER_A,
	MEMBER_B,
	mockApi,
	newState,
	ORG_A,
	ORG_B,
} from "./mock-api";

test("signed out shows both providers", async ({ page }, testInfo) => {
	await mockApi(page, newState({ session: "signed_out" }));
	const response = await page.goto("/");
	const headers = response?.headers() ?? {};
	expect(headers["x-powered-by"]).toBeUndefined();
	expect(headers).toMatchObject({
		"x-content-type-options": "nosniff",
		"x-frame-options": "DENY",
		"referrer-policy": "no-referrer",
	});
	expect(headers["content-security-policy"]).toContain(
		"frame-ancestors 'none'",
	);
	await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Sign in to Real Estate Ops",
	);
	const google = page.getByRole("link", { name: "Sign in with Google" });
	const microsoft = page.getByRole("link", { name: "Sign in with Microsoft" });
	await expect(google).toHaveAttribute("href", "/auth/google/login");
	await expect(microsoft).toHaveAttribute("href", "/auth/microsoft/login");

	await page.keyboard.press("Tab");
	await expectFocusRing(page.getByRole("link", { name: "Skip to content" }));
	await page.keyboard.press("Tab");
	await expectFocusRing(google);
	await page.keyboard.press("Tab");
	await expectFocusRing(microsoft);
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("signin.png"),
		fullPage: true,
	});
});

for (const [code, message] of [
	["failed", "Sign-in did not complete. Please try again."],
	[
		"no_access",
		"Your account does not have access yet. Ask your broker of record to add you.",
	],
	[
		"unavailable",
		"Sign-in is temporarily unavailable. Please try again shortly.",
	],
] as const) {
	test(`sign-in failure message: ${code}`, async ({ page }) => {
		await mockApi(page, newState({ session: "signed_out" }));
		await page.goto(`/?signin=${code}`);
		await expect(page.getByRole("main").getByRole("alert")).toHaveText(message);
		await expect(
			page.getByRole("link", { name: "Sign in with Google" }),
		).toBeVisible();
		await expectNoHorizontalScroll(page);
	});
}

test("an unknown sign-in code shows no message", async ({ page }) => {
	await mockApi(page, newState({ session: "signed_out" }));
	await page.goto("/?signin=<b>x</b>");
	await expect(
		page.getByRole("heading", { name: "Sign in to Real Estate Ops" }),
	).toBeVisible();
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("one brokerage goes straight to tasks", async ({ page }) => {
	await mockApi(page, newState({ session: [MEMBER_A] }));
	await page.goto("/");
	await expect(page).toHaveURL(`/o/${ORG_A}/tasks`);
	await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
});

test("two brokerages show the picker; choice is remembered", async ({
	page,
}, testInfo) => {
	await mockApi(page, newState({ session: [MEMBER_A, MEMBER_B] }));
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Choose a brokerage" }),
	).toBeVisible();
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("picker.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Synthetic Org B" }).click();
	await expect(page).toHaveURL(`/o/${ORG_B}/tasks`);
	await expect(page.getByText("No open tasks.")).toBeVisible();
	await page.goto("/");
	await expect(page).toHaveURL(`/o/${ORG_B}/tasks`);
});

test("stale remembered brokerage falls back to the picker", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			"reo.lastOrganization",
			"00000000-0000-4000-8000-00000000dead",
		),
	);
	await mockApi(page, newState({ session: [MEMBER_A, MEMBER_B] }));
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Choose a brokerage" }),
	).toBeVisible();
	await expect(page).toHaveURL("/");
});

test("stale remembered brokerage with one membership goes to it", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("reo.lastOrganization", "not-an-id"),
	);
	await mockApi(page, newState({ session: [MEMBER_A] }));
	await page.goto("/");
	await expect(page).toHaveURL(`/o/${ORG_A}/tasks`);
});

test("switch brokerage always shows the picker", async ({ page }) => {
	await mockApi(page, newState({ session: [MEMBER_A] }));
	await page.goto(`/o/${ORG_A}/tasks`);
	await expect(page.getByText("No open tasks.")).toBeVisible();
	await page.getByRole("link", { name: "Switch brokerage" }).click();
	await expect(
		page.getByRole("heading", { name: "Choose a brokerage" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Synthetic Org A" }),
	).toBeVisible();
});

test("a session error shows a fixed message", async ({ page }) => {
	await page.route("**/v1/session", (route) =>
		route.fulfill({ status: 500, body: "<b>stack trace</b>" }),
	);
	await page.goto("/");
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"Something went wrong. Please refresh the page.",
	);
	await expect(page.getByText("stack trace")).toHaveCount(0);
});
