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
	await expect(live(page)).toHaveText(
		"This task changed in another window. It now shows the latest status.",
	);
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
