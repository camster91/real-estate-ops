import { expect, type Page, test } from "@playwright/test";
import {
	expectFocusRing,
	expectNoHorizontalScroll,
	type MockClient,
	type MockDeal,
	type MockState,
	mockApi,
	newState,
	ORG_A,
	tabTo,
} from "./mock-api";

const DEALS = `/o/${ORG_A}/deals`;
const DEAL_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
});

const amy: MockClient = {
	id: "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f",
	name: "Amy Synthetic",
	email: null,
	phone: null,
	version: 1,
	createdAt: "2026-10-20T14:00:00.000Z",
};
const zed: MockClient = {
	...amy,
	id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e",
	name: "Zed Synthetic",
};

const deal = (overrides: Partial<MockDeal> = {}): MockDeal => ({
	id: DEAL_ID,
	side: "seller",
	stage: "draft",
	address: {
		street: "12 Main Street",
		unit: "4",
		city: "Ottawa",
		postalCode: "K1A 0B1",
	},
	clients: [{ id: amy.id, name: amy.name }],
	version: 1,
	createdAt: "2026-10-21T14:00:00.000Z",
	stageChangedAt: "2026-10-21T14:00:00.000Z",
	...overrides,
});

const state = (overrides: Partial<MockState> = {}) =>
	newState({
		clients: { [ORG_A]: [amy, zed] },
		deals: { [ORG_A]: [deal()] },
		...overrides,
	});

const posts = (s: MockState) =>
	s.requests.filter((r) => r.method === "POST" && r.path.endsWith("/deals"));
const patches = (s: MockState) =>
	s.requests.filter((r) => r.method === "PATCH" && r.path.includes("/deals/"));

const live = (page: Page) =>
	page.getByRole("main").locator('[aria-live="polite"]');

const fillDeal = async (page: Page) => {
	await page.getByLabel("We represent the").selectOption("buyer");
	await page.getByLabel("Street address").fill("1 King St W");
	await page.getByLabel("City").fill("Toronto");
	await page.getByLabel("Postal code").fill("m5h1a1");
};

test("list shows deals with side, stage and clients", async ({
	page,
}, testInfo) => {
	await mockApi(page, state());
	await page.goto(DEALS);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deals");
	const item = page.getByRole("list", { name: "Deals" }).getByRole("listitem");
	await expect(item).toHaveCount(1);
	await expect(item).toContainText("12 Main Street, Unit 4, Ottawa ON K1A 0B1");
	await expect(item).toContainText("Seller · Draft · Amy Synthetic");
	await expect(
		page.getByText("Stage names are placeholders", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Deals", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("deals.png"),
		fullPage: true,
	});
});

test("empty state, and no clients yet", async ({ page }) => {
	await mockApi(page, newState());
	await page.goto(DEALS);
	await expect(
		page.getByText("No deals yet. Add your first deal below."),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Add a client first" }),
	).toHaveAttribute("href", `/o/${ORG_A}/clients`);
});

test("add a deal", async ({ page }) => {
	const s = state({ deals: { [ORG_A]: [] } });
	await mockApi(page, s);
	await page.goto(DEALS);
	await fillDeal(page);
	await page.getByLabel("Unit (optional)").fill("");
	await page.getByRole("checkbox", { name: "Zed Synthetic" }).check();
	await page.getByRole("checkbox", { name: "Amy Synthetic" }).check();
	await page.getByRole("button", { name: "Add deal" }).click();
	await expect(live(page)).toHaveText("Deal added.");
	const list = page.getByRole("list", { name: "Deals" });
	await expect(list).toContainText("1 King St W, Toronto ON M5H 1A1");
	await expect(list).toContainText("Buyer · Draft");
	await expect(page.getByLabel("Street address")).toHaveValue("");
	await expect(
		page.getByRole("checkbox", { name: "Amy Synthetic" }),
	).not.toBeChecked();
	expect(posts(s)[0]?.body).toEqual({
		id: expect.stringMatching(UUID),
		side: "buyer",
		address: { street: "1 King St W", city: "Toronto", postalCode: "m5h1a1" },
		clientIds: [zed.id, amy.id],
	});
	await expectNoHorizontalScroll(page);
});

test("a deal needs at least one client", async ({ page }) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(DEALS);
	await fillDeal(page);
	await page.getByRole("button", { name: "Add deal" }).click();
	await expect(page.getByText("Choose 1 to 4 of your clients.")).toBeVisible();
	await expect(
		page.getByRole("checkbox", { name: "Amy Synthetic" }),
	).toBeFocused();
	await expect(
		page.getByRole("group", { name: "Clients on this deal" }),
	).toHaveAccessibleDescription("Choose 1 to 4 of your clients.");
	expect(posts(s)).toHaveLength(0);
});

test("server rejects the postal code", async ({ page }) => {
	await mockApi(
		page,
		state({
			dealReplies: [
				{ status: 400, body: { error: "invalid_deal", field: "postalCode" } },
			],
		}),
	);
	await page.goto(DEALS);
	await fillDeal(page);
	await page.getByRole("checkbox", { name: "Amy Synthetic" }).check();
	await page.getByRole("button", { name: "Add deal" }).click();
	const postal = page.getByLabel("Postal code");
	await expect(
		page.getByText("Enter an Ontario postal code, like K1A 0B1."),
	).toBeVisible();
	await expect(postal).toHaveAttribute("aria-invalid", "true");
	await expectFocusRing(postal);
});

test("retry reuses the id", async ({ page }) => {
	const s = state({ dealReplies: ["abort"] });
	await mockApi(page, s);
	await page.goto(DEALS);
	await fillDeal(page);
	await page.getByRole("checkbox", { name: "Amy Synthetic" }).check();
	await page.getByRole("button", { name: "Add deal" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"That deal could not be saved. Please try again.",
	);
	await page.getByRole("button", { name: "Add deal" }).click();
	await expect(live(page)).toHaveText("Deal added.");
	const [first, retry] = posts(s).map((r) => (r.body as { id: string }).id);
	expect(retry).toBe(first);
});

test("open a deal and move it", async ({ page }, testInfo) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(DEALS);
	await page
		.getByRole("link", { name: "12 Main Street, Unit 4, Ottawa ON K1A 0B1" })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"12 Main Street, Unit 4, Ottawa ON K1A 0B1",
	);
	await expect(
		page.getByText("Draft, since Wed, Oct 21, 10:00 a.m."),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Amy Synthetic" }),
	).toHaveAttribute("href", `/o/${ORG_A}/clients/${amy.id}`);
	const select = page.getByLabel("Move to");
	await expect(select.locator("option")).toHaveText([
		"Active",
		"Conditional",
		"Firm",
		"Closed",
		"Fell through",
	]);
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("deal.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Move deal" }).click();
	await expect(live(page)).toHaveText("Deal moved to Active.");
	await expect(page.getByText("Active, since")).toBeVisible();
	expect(patches(s)[0]?.body).toEqual({ stage: "active", version: 1 });
});

test("a deal changed elsewhere shows the latest stage", async ({ page }) => {
	const stored = deal();
	const s = state({ deals: { [ORG_A]: [stored] } });
	await mockApi(page, s);
	await page.goto(`${DEALS}/${DEAL_ID}`);
	await expect(page.getByLabel("Move to")).toBeVisible();
	Object.assign(stored, { stage: "firm", version: 3 });
	await page.getByLabel("Move to").selectOption("conditional");
	await page.getByRole("button", { name: "Move deal" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"This deal was changed in another window.",
	);
	await expect(page.getByText("Firm, since")).toBeVisible();
	await page.getByLabel("Move to").selectOption("closed");
	await page.getByRole("button", { name: "Move deal" }).click();
	await expect(live(page)).toHaveText("Deal moved to Closed.");
	expect(patches(s)[1]?.body).toEqual({ stage: "closed", version: 3 });
	await expect(page.getByText("A closed deal cannot be moved.")).toBeVisible();
	await expect(page.getByLabel("Move to")).toHaveCount(0);
});

test("a deal that fell through can only reopen", async ({ page }) => {
	await mockApi(
		page,
		state({ deals: { [ORG_A]: [deal({ stage: "fell_through" })] } }),
	);
	await page.goto(`${DEALS}/${DEAL_ID}`);
	await expect(page.getByLabel("Move to").locator("option")).toHaveText([
		"Active",
	]);
});

test("a deal that is not yours is not found", async ({ page }) => {
	await mockApi(page, state());
	await page.goto(`${DEALS}/00000000-0000-4000-8000-000000000000`);
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"This deal is not available to you.",
	);
});

test("keyboard only: move a deal", async ({ page }) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(`${DEALS}/${DEAL_ID}`);
	const select = page.getByLabel("Move to");
	await tabTo(page, select, 25);
	await expectFocusRing(select);
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Tab");
	await expect(page.getByRole("button", { name: "Move deal" })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(live(page)).toHaveText("Deal moved to Conditional.");
	expect(patches(s)).toHaveLength(1);
});
