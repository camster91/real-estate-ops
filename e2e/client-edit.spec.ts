import { expect, type Page, test } from "@playwright/test";
import {
	expectFocusRing,
	expectNoHorizontalScroll,
	type MockClient,
	type MockState,
	mockApi,
	newState,
	ORG_A,
} from "./mock-api";

const ID = "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f";
const PAGE = `/o/${ORG_A}/clients/${ID}`;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
});

const client = (overrides: Partial<MockClient> = {}): MockClient => ({
	id: ID,
	name: "Synthetic Client",
	email: "synthetic.client@example.invalid",
	phone: "4165550100",
	version: 1,
	createdAt: "2026-10-20T14:00:00.000Z",
	...overrides,
});

const withClient = (overrides: Partial<MockState> = {}) =>
	newState({ clients: { [ORG_A]: [client()] }, ...overrides });

const sent = (state: MockState, method: string, suffix = ID) =>
	state.requests.filter((r) => r.method === method && r.path.endsWith(suffix));

const live = (page: Page) =>
	page.getByRole("main").locator('[aria-live="polite"]');

test("edit details", async ({ page }) => {
	const state = withClient();
	await mockApi(page, state);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Edit details" }).click();
	const name = page.getByLabel("Name");
	await expect(name).toBeFocused();
	await expect(name).toHaveValue("Synthetic Client");
	await name.fill("Renamed Synthetic");
	await page.getByLabel("Phone (optional)").fill("");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(live(page)).toHaveText("Client details saved.");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Renamed Synthetic",
	);
	await expect(page.getByText("Not given")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Edit details" }),
	).toBeFocused();
	expect(sent(state, "PATCH")[0]?.body).toEqual({
		version: 1,
		name: "Renamed Synthetic",
		email: "synthetic.client@example.invalid",
		phone: "",
	});
	await expectNoHorizontalScroll(page);
});

test("cancel keeps the saved details", async ({ page }) => {
	const state = withClient();
	await mockApi(page, state);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Edit details" }).click();
	await page.getByLabel("Name").fill("Not Saved");
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Synthetic Client",
	);
	await expect(
		page.getByRole("button", { name: "Edit details" }),
	).toBeFocused();
	expect(sent(state, "PATCH")).toHaveLength(0);
});

test("changed in another window shows the latest details", async ({ page }) => {
	const stored = client();
	const state = newState({ clients: { [ORG_A]: [stored] } });
	await mockApi(page, state);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Edit details" }).click();
	// Someone else saves first.
	Object.assign(stored, { name: "Changed Elsewhere", version: 2 });
	await page.getByLabel("Name").fill("My Change");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"This client was changed in another window.",
	);
	await expect(page.getByLabel("Name")).toHaveValue("Changed Elsewhere");
	await page.getByLabel("Name").fill("My Change");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(live(page)).toHaveText("Client details saved.");
	// The second try sends the version it was shown.
	expect(sent(state, "PATCH")[1]?.body).toMatchObject({ version: 2 });
	expect(stored).toMatchObject({ name: "My Change", version: 3 });
});

test("server rejects the phone", async ({ page }) => {
	await mockApi(
		page,
		withClient({
			clientPatchReplies: [
				{ status: 400, body: { error: "invalid_client", field: "phone" } },
			],
		}),
	);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Edit details" }).click();
	const phone = page.getByLabel("Phone (optional)");
	await phone.fill("12");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(
		page.getByText("Enter a phone number with 7 to 15 digits."),
	).toBeVisible();
	await expect(phone).toHaveAttribute("aria-invalid", "true");
	await expectFocusRing(phone);
});

test("a failed save can be retried", async ({ page }) => {
	await mockApi(page, withClient({ clientPatchReplies: ["abort"] }));
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Edit details" }).click();
	await page.getByLabel("Name").fill("Retry Synthetic");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"The changes could not be saved. Please try again.",
	);
	await expect(page.getByLabel("Name")).toHaveValue("Retry Synthetic");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(live(page)).toHaveText("Client details saved.");
});

test("session ended while editing keeps the changes", async ({ page }) => {
	await mockApi(
		page,
		withClient({
			clientPatchReplies: [
				{ status: 401, body: { error: "authentication_required" } },
			],
		}),
	);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Edit details" }).click();
	await page.getByLabel("Name").fill("Unsaved Synthetic");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
	await expect(page.getByLabel("Name")).toHaveValue("Unsaved Synthetic");
});

test("consent starts as not recorded, with the placeholder note", async ({
	page,
}, testInfo) => {
	await mockApi(page, withClient());
	await page.goto(PAGE);
	await expect(
		page.getByText("The consent wording is a placeholder"),
	).toBeVisible();
	const consent = page.getByRole("list", { name: "Consent" });
	await expect(consent.getByRole("listitem")).toHaveCount(2);
	await expect(consent.getByText("Not recorded")).toHaveCount(2);
	await expect(page.getByText("Nothing recorded yet.")).toBeVisible();
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("client-consent.png"),
		fullPage: true,
	});
});

test("record consent, then a withdrawal", async ({ page }) => {
	const state = withClient();
	await mockApi(page, state);
	await page.goto(PAGE);
	const updates = page
		.getByRole("list", { name: "Consent" })
		.getByRole("listitem")
		.nth(1);
	await updates.getByLabel("How").selectOption("electronic");
	await updates.getByRole("button", { name: /^Record consent/ }).click();
	await expect(live(page)).toHaveText("Consent recorded.");
	await expect(updates).toContainText("Given (electronic) · ");
	await updates.getByRole("button", { name: /^Record withdrawal/ }).click();
	await expect(live(page)).toHaveText("Withdrawal recorded.");
	await expect(updates).toContainText("Withdrawn (electronic)");
	const history = page.getByRole("list", { name: "Consent history" });
	await expect(history.getByRole("listitem")).toHaveCount(2);
	await expect(history.getByRole("listitem").first()).toContainText(
		"Withdrawn",
	);
	const [first, second] = sent(state, "POST", "/consents").map((r) => r.body);
	expect(first).toEqual({
		id: expect.stringMatching(UUID),
		purpose: "market_updates",
		status: "granted",
		method: "electronic",
	});
	expect((second as { id: string }).id).not.toBe((first as { id: string }).id);
});

test("a failed recording retries with the same id", async ({ page }) => {
	const state = withClient({ consentReplies: ["abort"] });
	await mockApi(page, state);
	await page.goto(PAGE);
	const record = page.getByRole("button", { name: /^Record consent/ }).first();
	await record.click();
	await expect(
		page.getByText("That could not be recorded. Please try again."),
	).toBeVisible();
	await record.click();
	await expect(live(page)).toHaveText("Consent recorded.");
	const [first, retry] = sent(state, "POST", "/consents").map(
		(r) => (r.body as { id: string }).id,
	);
	expect(retry).toBe(first);
	await expect(
		page.getByRole("list", { name: "Consent history" }).getByRole("listitem"),
	).toHaveCount(1);
});

test("consent that cannot load offers a retry", async ({ page }) => {
	const state = withClient({ consents: { [ID]: "error" } });
	await mockApi(page, state);
	await page.goto(PAGE);
	await expect(page.getByText("Consent could not be loaded.")).toBeVisible();
	state.consents = {};
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(
		page.getByRole("list", { name: "Consent" }).getByText("Not recorded"),
	).toHaveCount(2);
});

test("an edit saved with its reply lost is fine on retry", async ({ page }) => {
	const state = withClient({ clientPatchReplies: ["commit_then_abort"] });
	await mockApi(page, state);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Edit details" }).click();
	await page.getByLabel("Name").fill("Lost Reply");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"The changes could not be saved. Please try again.",
	);
	// The retry sends the same values, which the API treats as unchanged.
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(live(page)).toHaveText("Client details saved.");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Lost Reply",
	);
});

test("a recording saved with its reply lost shows as recorded", async ({
	page,
}) => {
	const state = withClient({ consentReplies: ["commit_then_abort"] });
	await mockApi(page, state);
	await page.goto(PAGE);
	const updates = page
		.getByRole("list", { name: "Consent" })
		.getByRole("listitem")
		.nth(1);
	await updates.getByRole("button", { name: /^Record consent/ }).click();
	await expect(live(page)).toHaveText("Consent recorded.");
	await expect(updates).toContainText("Given (written)");
	// A later withdrawal and a fresh grant each make a new record.
	await updates.getByRole("button", { name: /^Record withdrawal/ }).click();
	await expect(live(page)).toHaveText("Withdrawal recorded.");
	await updates.getByRole("button", { name: /^Record consent/ }).click();
	await expect(live(page)).toHaveText("Consent recorded.");
	await expect(updates).toContainText("Given (written)");
	const ids = sent(state, "POST", "/consents").map(
		(r) => (r.body as { id: string }).id,
	);
	expect(new Set(ids).size).toBe(3);
	await expect(
		page.getByRole("list", { name: "Consent history" }).getByRole("listitem"),
	).toHaveCount(3);
});

test("a conflicting recording says to check the history", async ({ page }) => {
	await mockApi(
		page,
		withClient({
			consentReplies: [{ status: 409, body: { error: "conflict" } }],
		}),
	);
	await page.goto(PAGE);
	await page
		.getByRole("button", { name: /^Record consent/ })
		.first()
		.click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"That may already be recorded. Check the history below before trying again.",
	);
});

test("each How select names its purpose", async ({ page }) => {
	await mockApi(page, withClient());
	await page.goto(PAGE);
	await expect(
		page.getByRole("combobox", { name: /^How\W+Send me market updates/ }),
	).toBeVisible();
	await expect(
		page.getByRole("combobox", { name: /^How\W+Contact me about/ }),
	).toBeVisible();
});

test("signed out while recording offers sign-in", async ({ page }) => {
	await mockApi(
		page,
		withClient({
			consentReplies: [
				{ status: 401, body: { error: "authentication_required" } },
			],
		}),
	);
	await page.goto(PAGE);
	await page
		.getByRole("button", { name: /^Record consent/ })
		.first()
		.click();
	await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
