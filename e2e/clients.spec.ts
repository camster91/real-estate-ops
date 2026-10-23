import { expect, type Page, test } from "@playwright/test";
import {
	expectFocusRing,
	expectNoHorizontalScroll,
	type MockClient,
	type MockState,
	mockApi,
	newState,
	ORG_A,
	tabTo,
} from "./mock-api";

const CLIENTS = `/o/${ORG_A}/clients`;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
});

const client = (overrides: Partial<MockClient> = {}): MockClient => ({
	id: "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f",
	name: "Synthetic Client",
	email: "synthetic.client@example.invalid",
	phone: "4165550100",
	version: 1,
	createdAt: "2026-10-20T14:00:00.000Z",
	...overrides,
});

const posts = (state: MockState) =>
	state.requests.filter(
		(r) => r.method === "POST" && r.path.endsWith("/clients"),
	);

const live = (page: Page) =>
	page.getByRole("main").locator('[aria-live="polite"]');

test("list shows clients with contact details", async ({ page }, testInfo) => {
	await mockApi(
		page,
		newState({
			clients: {
				[ORG_A]: [
					client(),
					client({
						id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e",
						name: "Alex Synthetic",
						email: null,
						phone: null,
					}),
				],
			},
		}),
	);
	await page.goto(CLIENTS);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clients");
	const list = page.getByRole("list", { name: "Clients" });
	await expect(list.getByRole("listitem")).toHaveCount(2);
	await expect(list.getByRole("listitem").first()).toContainText(
		"Alex Synthetic",
	);
	await expect(list.getByRole("listitem").first()).toContainText(
		"No contact details",
	);
	await expect(list.getByRole("listitem").nth(1)).toContainText(
		"synthetic.client@example.invalid · (416) 555-0100",
	);
	await expect(
		page.getByRole("link", { name: "Clients", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("clients.png"),
		fullPage: true,
	});
});

test("empty state", async ({ page }) => {
	await mockApi(page, newState());
	await page.goto(CLIENTS);
	await expect(
		page.getByText("No clients yet. Add your first client below."),
	).toBeVisible();
});

test("add a client", async ({ page }) => {
	const state = newState();
	await mockApi(page, state);
	await page.goto(CLIENTS);
	await page.getByLabel("Name").fill("Élodie Synthetic");
	await page.getByLabel("Email (optional)").fill("Elodie@Example.invalid");
	await page.getByLabel("Phone (optional)").fill("(647) 555-0199");
	await page.getByRole("button", { name: "Add client" }).click();
	await expect(live(page)).toHaveText("Client added.");
	const list = page.getByRole("list", { name: "Clients" });
	await expect(list).toContainText("Élodie Synthetic");
	await expect(list).toContainText("(647) 555-0199");
	await expect(page.getByLabel("Name")).toHaveValue("");
	expect(posts(state)[0]?.body).toEqual({
		id: expect.stringMatching(UUID),
		name: "Élodie Synthetic",
		email: "Elodie@Example.invalid",
		phone: "(647) 555-0199",
	});
	await expectNoHorizontalScroll(page);
});

test("optional fields are left out when empty", async ({ page }) => {
	const state = newState();
	await mockApi(page, state);
	await page.goto(CLIENTS);
	await page.getByLabel("Name").fill("Name Only");
	await page.getByLabel("Name").press("Enter");
	await expect(live(page)).toHaveText("Client added.");
	expect(Object.keys(posts(state)[0]?.body as object).sort()).toEqual([
		"id",
		"name",
	]);
});

test("server rejects the email", async ({ page }) => {
	const state = newState({
		clientReplies: [
			{ status: 400, body: { error: "invalid_client", field: "email" } },
		],
	});
	await mockApi(page, state);
	await page.goto(CLIENTS);
	await page.getByLabel("Name").fill("Synthetic");
	const email = page.getByLabel("Email (optional)");
	await email.fill("not-an-email");
	await page.getByRole("button", { name: "Add client" }).click();
	await expect(
		page.getByText("Enter a valid email address, like name@example.com."),
	).toBeVisible();
	await expect(email).toHaveAttribute("aria-invalid", "true");
	await expectFocusRing(email);
	await expect(email).toHaveValue("not-an-email");
});

test("retry reuses the id", async ({ page }) => {
	const state = newState({ clientReplies: ["abort"] });
	await mockApi(page, state);
	await page.goto(CLIENTS);
	await page.getByLabel("Name").fill("Synthetic Retry");
	await page.getByRole("button", { name: "Add client" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"That client could not be saved. Please try again.",
	);
	await page.getByRole("button", { name: "Add client" }).click();
	await expect(live(page)).toHaveText("Client added.");
	const [first, retry] = posts(state).map((r) => (r.body as { id: string }).id);
	expect(retry).toBe(first);
});

test("open a client", async ({ page }, testInfo) => {
	await mockApi(page, newState({ clients: { [ORG_A]: [client()] } }));
	await page.goto(CLIENTS);
	await page.getByRole("link", { name: "Synthetic Client" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Synthetic Client",
	);
	await expect(
		page.getByRole("link", { name: "synthetic.client@example.invalid" }),
	).toHaveAttribute("href", "mailto:synthetic.client@example.invalid");
	await expect(
		page.getByRole("link", { name: "(416) 555-0100" }),
	).toHaveAttribute("href", "tel:4165550100");
	await expect(page.getByText("Tue, Oct 20, 10:00 a.m.")).toBeVisible();
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("client.png"),
		fullPage: true,
	});
	await page.getByRole("link", { name: "Back to clients" }).click();
	await expect(page).toHaveURL(CLIENTS);
});

test("a client that is not yours is not found", async ({ page }) => {
	await mockApi(page, newState());
	await page.goto(`${CLIENTS}/00000000-0000-4000-8000-000000000000`);
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"This client is not available to you.",
	);
});

test("session expired on load goes to sign-in", async ({ page }) => {
	await mockApi(
		page,
		newState({ session: "signed_out", clients: { [ORG_A]: "signed_out" } }),
	);
	await page.goto(CLIENTS);
	await expect(
		page.getByRole("heading", { name: "Sign in to Real Estate Ops" }),
	).toBeVisible();
});

test("header moves between tasks and clients", async ({ page }) => {
	await mockApi(page, newState());
	await page.goto(`/o/${ORG_A}/tasks`);
	await expect(page.getByRole("link", { name: "My tasks" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await page.getByRole("link", { name: "Clients", exact: true }).click();
	await expect(page).toHaveURL(CLIENTS);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clients");
});

test("keyboard only", async ({ page }) => {
	const state = newState();
	await mockApi(page, state);
	await page.goto(CLIENTS);
	await expect(page.getByText("No clients yet.")).toBeVisible();
	const name = page.getByLabel("Name");
	await tabTo(page, name);
	await expectFocusRing(name);
	await page.keyboard.type("Keyboard Synthetic");
	await page.keyboard.press("Enter");
	await expect(live(page)).toHaveText("Client added.");
	expect(posts(state)).toHaveLength(1);
});
