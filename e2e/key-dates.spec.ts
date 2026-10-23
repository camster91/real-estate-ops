import { expect, type Page, test } from "@playwright/test";
import {
	expectFocusRing,
	expectNoHorizontalScroll,
	type MockDeal,
	type MockKeyDate,
	type MockState,
	mockApi,
	newState,
	ORG_A,
	tabTo,
} from "./mock-api";

const DEAL_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const PAGE = `/o/${ORG_A}/deals/${DEAL_ID}`;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// 8:00 a.m. in Toronto.
test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
});

const deal: MockDeal = {
	id: DEAL_ID,
	side: "buyer",
	stage: "conditional",
	address: {
		street: "1 King St W",
		unit: null,
		city: "Toronto",
		postalCode: "M5H 1A1",
	},
	clients: [],
	version: 1,
	createdAt: "2026-10-20T14:00:00.000Z",
	stageChangedAt: "2026-10-20T14:00:00.000Z",
};

const financing = (): MockKeyDate => ({
	id: "11111111-1111-4111-8111-111111111111",
	kind: "condition",
	label: "Financing",
	dueAt: "2026-10-23T03:59:00.000Z", // Thu Oct 22, 11:59 p.m.
	doneAt: null,
	version: 1,
});
const deposit = (): MockKeyDate => ({
	id: "22222222-2222-4222-8222-222222222222",
	kind: "deposit",
	label: null,
	dueAt: "2026-10-24T21:00:00.000Z", // Sat Oct 24, 5:00 p.m.
	doneAt: null,
	version: 1,
});
const closing = (): MockKeyDate => ({
	id: "33333333-3333-4333-8333-333333333333",
	kind: "closing",
	label: null,
	dueAt: "2026-12-15T22:00:00.000Z", // Tue Dec 15, 5:00 p.m.
	doneAt: null,
	version: 1,
});

const state = (overrides: Partial<MockState> = {}) =>
	newState({
		deals: { [ORG_A]: [{ ...deal }] },
		keyDates: { [DEAL_ID]: [closing(), financing(), deposit()] },
		...overrides,
	});

const live = (page: Page) =>
	page.getByRole("main").locator('[aria-live="polite"]');
const items = (page: Page) =>
	page.getByRole("list", { name: "Key dates" }).getByRole("listitem");
const saves = (s: MockState, method: string) =>
	s.requests.filter(
		(r) => r.method === method && r.path.includes("/key-dates"),
	);

test("key dates are listed in order with their state", async ({
	page,
}, testInfo) => {
	await mockApi(page, state());
	await page.goto(PAGE);
	await expect(items(page)).toHaveCount(3);
	await expect(items(page).nth(0)).toContainText(
		"Financing" + "Condition · Due Thu, Oct 22, 11:59 p.m. · Overdue",
	);
	await expect(items(page).nth(1)).toContainText(
		"Deposit due" + "Due Sat, Oct 24, 5:00 p.m. · Due soon",
	);
	await expect(items(page).nth(2)).toContainText(
		"Closing" + "Due Tue, Dec 15, 5:00 p.m. · Upcoming",
	);
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("key-dates.png"),
		fullPage: true,
	});
});

test("empty state", async ({ page }) => {
	await mockApi(page, state({ keyDates: {} }));
	await page.goto(PAGE);
	await expect(page.getByText("No key dates yet.")).toBeVisible();
});

test("add a condition in Toronto time", async ({ page }) => {
	const s = state({ keyDates: {} });
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByLabel("Name", { exact: true }).fill("Home inspection");
	await page.getByLabel("Due (Toronto time)").fill("2026-10-30T23:59");
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(live(page)).toHaveText("Key date added.");
	await expect(items(page)).toContainText("Home inspection");
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
	expect(saves(s, "POST")[0]?.body).toEqual({
		id: expect.stringMatching(UUID),
		kind: "condition",
		label: "Home inspection",
		dueAt: "2026-10-30T23:59:00-04:00",
	});
});

test("a closing needs no name; the winter offset is used", async ({ page }) => {
	const s = state({ keyDates: {} });
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByLabel("Type").selectOption("closing");
	await expect(page.getByLabel("Name (optional)")).toBeVisible();
	await page.getByLabel("Due (Toronto time)").fill("2026-12-15T17:00");
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(live(page)).toHaveText("Key date added.");
	expect(saves(s, "POST")[0]?.body).toMatchObject({
		kind: "closing",
		dueAt: "2026-12-15T17:00:00-05:00",
	});
});

test("a condition needs a name and a due time", async ({ page }) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Add key date" }).click();
	const name = page.getByLabel("Name", { exact: true });
	await expect(name).toBeFocused();
	await expect(name).toHaveAttribute("aria-invalid", "true");
	await expect(page.getByLabel("Due (Toronto time)")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(
		page.getByText("Enter a date and time between 2000 and 2100."),
	).toBeVisible();
	expect(saves(s, "POST")).toHaveLength(0);
});

test("a time skipped by the spring clock change is refused", async ({
	page,
}) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByLabel("Name", { exact: true }).fill("Financing");
	const due = page.getByLabel("Due (Toronto time)");
	await due.fill("2027-03-14T02:30");
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(
		page.getByText("That time does not exist in Toronto"),
	).toBeVisible();
	await expectFocusRing(due);
	expect(saves(s, "POST")).toHaveLength(0);
});

test("retry reuses the id", async ({ page }) => {
	const s = state({ keyDateReplies: ["abort"] });
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByLabel("Name", { exact: true }).fill("Appraisal");
	await page.getByLabel("Due (Toronto time)").fill("2026-10-28T17:00");
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(
		page.getByText("That could not be saved. Please try again."),
	).toBeVisible();
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(live(page)).toHaveText("Key date added.");
	const [first, retry] = saves(s, "POST").map(
		(r) => (r.body as { id: string }).id,
	);
	expect(retry).toBe(first);
});

test("mark a key date done, then not done", async ({ page }) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Mark done: Financing" }).click();
	await expect(live(page)).toHaveText("Financing marked done.");
	await expect(items(page).nth(0)).toContainText("· Done ");
	expect(saves(s, "PATCH")[0]?.body).toEqual({
		version: 1,
		label: "Financing",
		dueAt: "2026-10-23T03:59:00.000Z",
		done: true,
	});
	await page.getByRole("button", { name: "Mark not done: Financing" }).click();
	await expect(live(page)).toHaveText("Financing marked not done.");
	await expect(items(page).nth(0)).toContainText("Overdue");
	expect(saves(s, "PATCH")[1]?.body).toMatchObject({ version: 2, done: false });
});

test("change a date", async ({ page }) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Change: Financing" }).click();
	const due = page.locator(`#edit-due-${financing().id}`);
	await expect(due).toBeFocused();
	await expect(due).toHaveValue("2026-10-22T23:59");
	await due.fill("2026-10-27T23:59");
	await page.getByRole("button", { name: "Save Financing" }).click();
	await expect(live(page)).toHaveText("Financing saved.");
	await expect(items(page).nth(1)).toContainText(
		"Due Tue, Oct 27, 11:59 p.m. · Upcoming",
	);
	expect(saves(s, "PATCH")[0]?.body).toEqual({
		version: 1,
		label: "Financing",
		dueAt: "2026-10-27T23:59:00-04:00",
		done: false,
	});
});

test("changed in another window shows the latest", async ({ page }) => {
	const stored = financing();
	const s = state({ keyDates: { [DEAL_ID]: [stored] } });
	await mockApi(page, s);
	await page.goto(PAGE);
	await expect(items(page)).toHaveCount(1);
	Object.assign(stored, {
		version: 2,
		dueAt: "2026-10-30T03:59:00.000Z",
	});
	await page.getByRole("button", { name: "Mark done: Financing" }).click();
	await expect(items(page).getByRole("alert")).toHaveText(
		"This date was changed in another window. The latest is shown; check it and save again.",
	);
	await expect(items(page)).toContainText("Due Thu, Oct 29, 11:59 p.m.");
});

test("key dates that cannot load offer a retry", async ({ page }) => {
	const s = state({ keyDates: { [DEAL_ID]: "error" } });
	await mockApi(page, s);
	await page.goto(PAGE);
	await expect(page.getByText("Key dates could not be loaded.")).toBeVisible();
	s.keyDates = { [DEAL_ID]: [closing()] };
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(items(page)).toHaveCount(1);
});

test("keyboard only: mark done", async ({ page }) => {
	const s = state();
	await mockApi(page, s);
	await page.goto(PAGE);
	const button = page.getByRole("button", { name: "Mark done: Financing" });
	await tabTo(page, button, 30);
	await expectFocusRing(button);
	await page.keyboard.press("Enter");
	await expect(live(page)).toHaveText("Financing marked done.");
	expect(saves(s, "PATCH")).toHaveLength(1);
});

test("an add saved with its reply lost is added once on retry", async ({
	page,
}) => {
	const s = state({ keyDates: {}, keyDateReplies: ["commit_then_abort"] });
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByLabel("Name", { exact: true }).fill("Appraisal");
	await page.getByLabel("Due (Toronto time)").fill("2026-10-28T17:00");
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(page.getByText("That could not be saved.")).toBeVisible();
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(live(page)).toHaveText("Key date added.");
	expect(s.keyDates?.[DEAL_ID]).toHaveLength(1);
	await expect(items(page)).toHaveCount(1);
});

test("an add that conflicts reloads the list and says why", async ({
	page,
}) => {
	const s = state({
		keyDateReplies: [{ status: 409, body: { error: "conflict" } }],
	});
	await mockApi(page, s);
	await page.goto(PAGE);
	await expect(items(page)).toHaveCount(3);
	const lists = () =>
		s.requests.filter(
			(r) => r.method === "GET" && r.path.endsWith("/key-dates"),
		).length;
	const before = lists();
	await page.getByLabel("Name", { exact: true }).fill("Appraisal");
	await page.getByLabel("Due (Toronto time)").fill("2026-10-28T17:00");
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(
		page.getByText("An earlier try may already be saved."),
	).toBeVisible();
	expect(lists()).toBe(before + 1);
});

test("a deal with 200 key dates says so", async ({ page }) => {
	await mockApi(
		page,
		state({
			keyDateReplies: [{ status: 409, body: { error: "limit_reached" } }],
		}),
	);
	await page.goto(PAGE);
	await page.getByLabel("Name", { exact: true }).fill("One more");
	await page.getByLabel("Due (Toronto time)").fill("2026-10-28T17:00");
	await page.getByRole("button", { name: "Add key date" }).click();
	await expect(
		page.getByText("This deal already has 200 key dates."),
	).toBeVisible();
});

test("a failed edit keeps what was typed, then saves on retry", async ({
	page,
}) => {
	await mockApi(page, state({ keyDateReplies: ["abort"] }));
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Change: Financing" }).click();
	const due = page.locator(`#edit-due-${financing().id}`);
	await due.fill("2026-10-27T23:59");
	await page.getByRole("button", { name: "Save Financing" }).click();
	await expect(items(page).getByRole("alert")).toHaveText(
		"That could not be saved. Please try again.",
	);
	await expect(due).toHaveValue("2026-10-27T23:59");
	await page.getByRole("button", { name: "Save Financing" }).click();
	await expect(live(page)).toHaveText("Financing saved.");
});

test("an edit that conflicts stays open with the latest values", async ({
	page,
}) => {
	const stored = financing();
	await mockApi(page, state({ keyDates: { [DEAL_ID]: [stored] } }));
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Change: Financing" }).click();
	Object.assign(stored, {
		label: "Mortgage approval",
		version: 2,
	});
	await page.locator(`#edit-due-${stored.id}`).fill("2026-10-27T23:59");
	await page.getByRole("button", { name: "Save Financing" }).click();
	await expect(items(page).getByRole("alert")).toContainText(
		"This date was changed in another window.",
	);
	await expect(page.locator(`#edit-label-${stored.id}`)).toHaveValue(
		"Mortgage approval",
	);
	await expect(page.locator(`#edit-due-${stored.id}`)).toBeFocused();
});

test("a rejected due time shows on the field", async ({ page }) => {
	await mockApi(
		page,
		state({
			keyDateReplies: [
				{ status: 400, body: { error: "invalid_key_date", field: "dueAt" } },
			],
		}),
	);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Change: Financing" }).click();
	const due = page.locator(`#edit-due-${financing().id}`);
	await due.fill("2026-10-27T23:59");
	await page.getByRole("button", { name: "Save Financing" }).click();
	await expect(due).toHaveAttribute("aria-invalid", "true");
	await expect(due).toBeFocused();
});

test("focus returns to Change after saving or cancelling", async ({ page }) => {
	await mockApi(page, state());
	await page.goto(PAGE);
	const change = page.getByRole("button", { name: "Change: Financing" });
	await change.click();
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(change).toBeFocused();
	await change.click();
	await page.locator(`#edit-label-${financing().id}`).fill("Financing (bank)");
	await page.getByRole("button", { name: "Save Financing" }).click();
	await expect(live(page)).toHaveText("Financing (bank) saved.");
	await expect(
		page.getByRole("button", { name: "Change: Financing (bank)" }),
	).toBeFocused();
});

test("an untouched due time is sent exactly as stored", async ({ page }) => {
	// 1:30 a.m. EST on 1 November: the second 1:30 of the fall-back night.
	const late = { ...financing(), dueAt: "2026-11-01T06:30:15.000Z" };
	const s = state({ keyDates: { [DEAL_ID]: [late] } });
	await mockApi(page, s);
	await page.goto(PAGE);
	await page.getByRole("button", { name: "Change: Financing" }).click();
	await page.locator(`#edit-label-${late.id}`).fill("Financing (bank)");
	await page.getByRole("button", { name: "Save Financing" }).click();
	await expect(live(page)).toHaveText("Financing (bank) saved.");
	expect(saves(s, "PATCH")[0]?.body).toMatchObject({
		dueAt: "2026-11-01T06:30:15.000Z",
	});
});

test("two unnamed deposits have different button names", async ({ page }) => {
	const second = {
		...deposit(),
		id: "44444444-4444-4444-8444-444444444444",
		dueAt: "2026-11-20T22:00:00.000Z",
	};
	await mockApi(page, state({ keyDates: { [DEAL_ID]: [deposit(), second] } }));
	await page.goto(PAGE);
	await expect(
		page.getByRole("button", {
			name: "Mark done: Deposit due, due Sat, Oct 24",
		}),
	).toHaveCount(1);
	await expect(
		page.getByRole("button", {
			name: "Mark done: Deposit due, due Fri, Nov 20",
		}),
	).toHaveCount(1);
});

test("keyboard only: add a key date", async ({ page }) => {
	const s = state({ keyDates: {} });
	await mockApi(page, s);
	await page.goto(PAGE);
	const name = page.getByLabel("Name", { exact: true });
	await tabTo(page, name, 30);
	await expectFocusRing(name);
	await page.keyboard.type("Status certificate");
	await page.keyboard.press("Tab");
	await expect(page.getByLabel("Due (Toronto time)")).toBeFocused();
	await page.getByLabel("Due (Toronto time)").fill("2026-10-29T17:00");
	await page.keyboard.press("Enter");
	await expect(live(page)).toHaveText("Key date added.");
	expect(saves(s, "POST")).toHaveLength(1);
});
