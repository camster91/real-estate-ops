import { expect, type Page, test } from "@playwright/test";
import {
	expectFocusRing,
	expectNoHorizontalScroll,
	type MockState,
	type MockTask,
	mockApi,
	newState,
	ORG_A,
	tabTo,
} from "./mock-api";

// Due dates show the year only outside the current year; pin "today".
test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
});

const TASKS = `/o/${ORG_A}/tasks`;
const TITLE = "Synthetic status task";

const task = (overrides: Partial<MockTask> = {}): MockTask => ({
	id: "3a2b1c0d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
	title: TITLE,
	status: "ready",
	dueAt: null,
	version: 1,
	statusChangedAt: "2026-10-20T14:00:00.000Z",
	...overrides,
});

const patches = (state: MockState) =>
	state.requests.filter((r) => r.method === "PATCH");

async function open(page: Page, state: MockState) {
	await mockApi(page, state);
	await page.goto(TASKS);
	const select = page.getByRole("combobox", { name: `Status of ${TITLE}` });
	await expect(select).toBeVisible();
	return select;
}

const live = (page: Page) =>
	page.getByRole("main").locator('[aria-live="polite"]');

test("change status", async ({ page }) => {
	const state = newState({ tasks: { [ORG_A]: [task()] } });
	const select = await open(page, state);
	await select.selectOption("in_progress");
	await expect(live(page)).toHaveText("Status changed to In progress.");
	await expect(select).toHaveValue("in_progress");
	expect(patches(state)[0]?.body).toEqual({
		status: "in_progress",
		version: 1,
	});
	await expectNoHorizontalScroll(page);
});

test("finishing the last open task", async ({ page }, testInfo) => {
	const state = newState({ tasks: { [ORG_A]: [task()] } });
	const select = await open(page, state);
	await select.selectOption("completed");
	await expect(live(page)).toHaveText("Task marked done.");
	await expect(
		page.getByText("No open tasks. Add a task below."),
	).toBeVisible();
	const show = page.getByRole("button", { name: "Show done tasks" });
	await expect(show).toHaveAttribute("aria-expanded", "false");
	await show.click();
	const hide = page.getByRole("button", { name: "Hide done tasks" });
	await expect(hide).toHaveAttribute("aria-expanded", "true");
	const done = page.getByRole("list", { name: "Done tasks" });
	await expect(done).toContainText(TITLE);
	await expect(done).toContainText(
		/Done · \w{3}, \w{3} \d+, \d+:\d{2}\s[ap]\.m\./,
	);
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("done.png"),
		fullPage: true,
	});
	await hide.click();
	await expect(done).toBeHidden();
});

test("reopen", async ({ page }) => {
	const state = newState({
		tasks: { [ORG_A]: [task({ status: "cancelled", version: 2 })] },
	});
	await mockApi(page, state);
	await page.goto(TASKS);
	await expect(page.getByText("No open tasks.")).toBeVisible();
	await page.getByRole("button", { name: "Show done tasks" }).click();
	await expect(page.getByRole("list", { name: "Done tasks" })).toContainText(
		"Cancelled",
	);
	await page.getByRole("button", { name: `Reopen ${TITLE}` }).click();
	await expect(live(page)).toHaveText("Task reopened.");
	await expect(
		page.getByRole("combobox", { name: `Status of ${TITLE}` }),
	).toHaveValue("ready");
	await expect(page.getByText("No done tasks yet.")).toBeVisible();
	expect(patches(state)[0]?.body).toEqual({ status: "ready", version: 2 });
});

test("two tabs", async ({ page }) => {
	const state = newState({
		tasks: { [ORG_A]: [task()] },
		patchReplies: [
			{
				status: 409,
				body: {
					error: "conflict",
					task: task({ status: "blocked", version: 2 }),
				},
			},
		],
	});
	const select = await open(page, state);
	await select.selectOption("waiting");
	await expect(select).toHaveValue("blocked");
	await expect(
		page
			.getByRole("list", { name: "Tasks" })
			.getByText(
				"This task changed in another window. It now shows the latest status.",
			),
	).toBeVisible();
	await expect(select).toHaveAttribute("aria-describedby", /^message-/);
	await expectNoHorizontalScroll(page);
});

test("a change made elsewhere to done moves the task", async ({ page }) => {
	const state = newState({
		tasks: { [ORG_A]: [task()] },
		patchReplies: [
			{
				status: 409,
				body: {
					error: "conflict",
					task: task({ status: "completed", version: 2 }),
				},
			},
		],
	});
	const select = await open(page, state);
	await select.selectOption("waiting");
	await expect(page.getByText("No open tasks.")).toBeVisible();
	await expect(page.getByRole("main").locator(".page-notice")).toHaveText(
		`${TITLE} changed in another window and is now Done.`,
	);
	await expectFocusRing(page.getByRole("button", { name: "Show done tasks" }));
});

test("marking done moves focus to the next task", async ({ page }) => {
	const second = task({
		id: "4b3c2d1e-6f50-4b4c-9d3e-2f1a0b9c8d7e",
		title: "Synthetic second task",
	});
	const state = newState({ tasks: { [ORG_A]: [task(), second] } });
	const select = await open(page, state);
	await select.focus();
	await select.selectOption("completed");
	await expect(live(page)).toHaveText("Task marked done.");
	await expectFocusRing(
		page.getByRole("combobox", { name: "Status of Synthetic second task" }),
	);
});

test("marking the only task done focuses Show done tasks", async ({ page }) => {
	const state = newState({ tasks: { [ORG_A]: [task()] } });
	const select = await open(page, state);
	await select.focus();
	await select.selectOption("cancelled");
	await expect(live(page)).toHaveText("Task cancelled.");
	await expectFocusRing(page.getByRole("button", { name: "Show done tasks" }));
});

test("reopen focuses the reopened task", async ({ page }) => {
	const state = newState({
		tasks: { [ORG_A]: [task({ status: "completed", version: 2 })] },
	});
	await mockApi(page, state);
	await page.goto(TASKS);
	await page.getByRole("button", { name: "Show done tasks" }).click();
	await page.getByRole("button", { name: `Reopen ${TITLE}` }).click();
	await expect(live(page)).toHaveText("Task reopened.");
	await expectFocusRing(
		page.getByRole("combobox", { name: `Status of ${TITLE}` }),
	);
});

test("a task finished while the done list loads still appears", async ({
	page,
}) => {
	const state = newState({ tasks: { [ORG_A]: [task()] } });
	const select = await open(page, state);
	state.listDelay = 1500;
	await page.getByRole("button", { name: "Show done tasks" }).click();
	await expect(page.getByText("Loading done tasks…")).toBeVisible();
	await select.selectOption("completed");
	await expect(live(page)).toHaveText("Task marked done.");
	const done = page.getByRole("list", { name: "Done tasks" });
	await expect(done).toContainText(TITLE, { timeout: 5000 });
});

test("tasks with the same title get distinct names", async ({ page }) => {
	const twin = task({ id: "6d5e4f30-8b72-4d6e-9f50-4b3c2d1e0f9a" });
	await mockApi(page, newState({ tasks: { [ORG_A]: [task(), twin] } }));
	await page.goto(TASKS);
	await expect(
		page.getByRole("combobox", { name: `Status of ${TITLE} (1 of 2)` }),
	).toBeVisible();
	await expect(
		page.getByRole("combobox", { name: `Status of ${TITLE} (2 of 2)` }),
	).toBeVisible();
});

test("a later change clears old row messages", async ({ page }) => {
	const other = task({
		id: "7e6f5a41-9c83-4e7f-a061-5c4d3e2f1a0b",
		title: "Synthetic other task",
	});
	const state = newState({
		tasks: { [ORG_A]: [task(), other] },
		patchReplies: ["abort"],
	});
	const select = await open(page, state);
	await select.selectOption("waiting");
	const message = page.getByText(
		"The status could not be changed. Please try again.",
	);
	await expect(message).toBeVisible();
	await page
		.getByRole("combobox", { name: "Status of Synthetic other task" })
		.selectOption("blocked");
	await expect(live(page)).toHaveText("Status changed to Blocked.");
	await expect(message).toHaveCount(0);
});

test("in flight", async ({ page }) => {
	const state = newState({ tasks: { [ORG_A]: [task()] }, patchDelay: 1500 });
	const select = await open(page, state);
	await select.selectOption("blocked");
	await expect(select).toBeDisabled();
	await expect(select).toHaveValue("blocked");
	await expect(select).toBeEnabled({ timeout: 5000 });
	await expect(live(page)).toHaveText("Status changed to Blocked.");
	expect(patches(state)).toHaveLength(1);
});

test("error restores the old value", async ({ page }) => {
	const state = newState({
		tasks: { [ORG_A]: [task()] },
		patchReplies: ["abort"],
	});
	const select = await open(page, state);
	await select.selectOption("waiting");
	await expect(
		page.getByText("The status could not be changed. Please try again."),
	).toBeVisible();
	await expect(select).toHaveValue("ready");
	await expect(select).toBeEnabled();
});

test("session ended on a status change", async ({ page }) => {
	const state = newState({
		tasks: { [ORG_A]: [task()] },
		patchReplies: [{ status: 401, body: { error: "authentication_required" } }],
	});
	const select = await open(page, state);
	await select.selectOption("waiting");
	await expect(
		page.getByText("Your session has ended. Sign in again to change it."),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
		"href",
		"/",
	);
	await expect(select).toHaveValue("ready");
});

test("keyboard", async ({ page }) => {
	const state = newState({ tasks: { [ORG_A]: [task()] } });
	const select = await open(page, state);
	await tabTo(page, select);
	await expectFocusRing(select);
	await select.selectOption("in_progress");
	await expect(live(page)).toHaveText("Status changed to In progress.");
	const show = page.getByRole("button", { name: "Show done tasks" });
	await tabTo(page, show);
	await expectFocusRing(show);
	await page.keyboard.press("Enter");
	await expect(page.getByText("No done tasks yet.")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Hide done tasks" }),
	).toBeFocused();
});
