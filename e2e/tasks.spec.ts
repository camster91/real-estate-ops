import { expect, test } from "@playwright/test";
import {
	expectFocusRing,
	expectNoHorizontalScroll,
	type MockState,
	mockApi,
	newState,
	ORG_A,
	tabTo,
} from "./mock-api";

const TASKS = `/o/${ORG_A}/tasks`;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const posts = (state: MockState) =>
	state.requests.filter(
		(r) => r.method === "POST" && r.path.endsWith("/tasks"),
	);
const postedIds = (state: MockState) =>
	posts(state).map((r) => (r.body as { id: string }).id);

test("loading then list", async ({ page }, testInfo) => {
	const state = newState({
		listDelay: 800,
		tasks: {
			[ORG_A]: [
				{
					id: "1f2e3d4c-5b6a-4789-8abc-def012345678",
					title: "Call the synthetic lender",
					status: "ready",
					dueAt: "2026-11-01T14:00:00.000Z",
					version: 1,
				},
				{
					id: "2f2e3d4c-5b6a-4789-8abc-def012345678",
					title: "Order a synthetic status certificate",
					status: "waiting",
					dueAt: null,
					version: 1,
				},
			],
		},
	});
	await mockApi(page, state);
	await page.goto(TASKS);
	await expect(page.getByText("Loading tasks…")).toBeVisible();
	const list = page.getByRole("list", { name: "Tasks" });
	await expect(list.getByRole("listitem")).toHaveCount(2);
	await expect(list.getByRole("listitem").first()).toContainText(
		"Call the synthetic lender",
	);
	await expect(list.getByRole("listitem").first()).toContainText(
		/Ready · Sun, Nov 1, 9:00\sa\.m\./,
	);
	await expect(list.getByRole("listitem").nth(1)).toContainText(
		"Waiting · No due date",
	);
	await expect(page.getByText("Loading tasks…")).toHaveCount(0);
	await expectNoHorizontalScroll(page);
	await page.screenshot({
		path: testInfo.outputPath("tasks.png"),
		fullPage: true,
	});
});

test("empty state", async ({ page }) => {
	await mockApi(page, newState());
	await page.goto(TASKS);
	await expect(
		page.getByText("No tasks yet. Add your first task below."),
	).toBeVisible();
	await expectNoHorizontalScroll(page);
});

test("load error and try again", async ({ page }) => {
	const state = newState({ tasks: { [ORG_A]: "error" } });
	await mockApi(page, state);
	await page.goto(TASKS);
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Tasks could not be loaded.",
	);
	await expectNoHorizontalScroll(page);
	state.tasks[ORG_A] = [];
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByText("No tasks yet.")).toBeVisible();
});

test("add a task", async ({ page }) => {
	const state = newState();
	await mockApi(page, state);
	await page.goto(TASKS);
	await page.getByLabel("Title").fill("Book a synthetic showing");
	await page.getByLabel("Due (Toronto time)").fill("2026-11-01T09:00");
	await page.getByLabel("Title").press("Enter");

	const list = page.getByRole("list", { name: "Tasks" });
	await expect(list).toContainText("Book a synthetic showing");
	await expect(list).toContainText(/Sun, Nov 1, 9:00\sa\.m\./);
	await expect(page.getByText("Task added.")).toBeAttached();
	await expect(page.getByLabel("Title")).toHaveValue("");
	await expect(page.getByLabel("Due (Toronto time)")).toHaveValue("");
	const [post] = posts(state);
	expect(post?.body).toEqual({
		id: expect.stringMatching(UUID),
		title: "Book a synthetic showing",
		dueAt: "2026-11-01T09:00:00-05:00",
	});
	await expectNoHorizontalScroll(page);
});

test("retry reuses the id", async ({ page }) => {
	const state = newState({ createReplies: ["abort"] });
	await mockApi(page, state);
	await page.goto(TASKS);
	await page.getByLabel("Title").fill("Synthetic retry");
	await page.getByRole("button", { name: "Add task" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText(
		"That task could not be saved. Please try again.",
	);
	await expect(page.getByLabel("Title")).toHaveValue("Synthetic retry");
	await page.getByRole("button", { name: "Add task" }).click();
	await expect(page.getByText("Task added.")).toBeAttached();
	await page.getByLabel("Title").fill("Synthetic second task");
	await page.getByRole("button", { name: "Add task" }).click();
	await expect(page.getByRole("list", { name: "Tasks" })).toContainText(
		"Synthetic second task",
	);
	const [first, retry, second] = postedIds(state);
	expect(retry).toBe(first);
	expect(second).not.toBe(first);
});

test("server rejects the title", async ({ page }) => {
	const state = newState({
		createReplies: [
			{ status: 400, body: { error: "invalid_task", field: "title" } },
		],
	});
	await mockApi(page, state);
	await page.goto(TASKS);
	const title = page.getByLabel("Title");
	await title.fill("Synthetic​title");
	await page.getByRole("button", { name: "Add task" }).click();
	const message = page.getByText(
		"Enter a title of 1 to 200 characters without line breaks.",
	);
	await expect(message).toBeVisible();
	await expect(title).toHaveAttribute("aria-invalid", "true");
	await expect(title).toHaveAttribute("aria-describedby", "title-error");
	await expectFocusRing(title);
	await expect(title).toHaveValue("Synthetic​title");
	await expectNoHorizontalScroll(page);
});

test("an empty title is checked by the server and shown inline", async ({
	page,
}) => {
	const state = newState({
		createReplies: [
			{ status: 400, body: { error: "invalid_task", field: "title" } },
		],
	});
	await mockApi(page, state);
	await page.goto(TASKS);
	await page.getByRole("button", { name: "Add task" }).click();
	await expect(page.getByLabel("Title")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
});

test("nonexistent time is caught before sending", async ({ page }) => {
	const state = newState();
	await mockApi(page, state);
	await page.goto(TASKS);
	await page.getByLabel("Title").fill("Synthetic spring forward");
	const due = page.getByLabel("Due (Toronto time)");
	await due.fill("2026-03-08T02:30");
	await page.getByRole("button", { name: "Add task" }).click();
	await expect(
		page.getByText(
			"That time does not exist in Toronto (clocks change). Pick another time.",
		),
	).toBeVisible();
	await expect(due).toHaveAttribute("aria-invalid", "true");
	await expect(due).toBeFocused();
	expect(posts(state)).toHaveLength(0);
});

test("session expired on load goes to sign-in", async ({ page }) => {
	await mockApi(
		page,
		newState({ session: "signed_out", tasks: { [ORG_A]: "signed_out" } }),
	);
	await page.goto(TASKS);
	await expect(
		page.getByRole("heading", { name: "Sign in to Real Estate Ops" }),
	).toBeVisible();
	await expect(page).toHaveURL("/");
});

test("session expired on add keeps the typed task", async ({ page }) => {
	const state = newState({
		createReplies: [
			{ status: 401, body: { error: "authentication_required" } },
		],
	});
	await mockApi(page, state);
	await page.goto(TASKS);
	await page.getByLabel("Title").fill("Synthetic unsaved");
	await page.getByRole("button", { name: "Add task" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Your session has ended. Sign in again, then add this task.",
	);
	await expect(page.getByLabel("Title")).toHaveValue("Synthetic unsaved");
	await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
		"href",
		"/",
	);
});

test("brokerage not available", async ({ page }) => {
	await mockApi(page, newState({ tasks: { [ORG_A]: "not_found" } }));
	await page.goto(TASKS);
	const alert = page.getByRole("main").getByRole("alert");
	await expect(alert).toContainText("This brokerage is not available to you.");
	await expect(
		alert.getByRole("link", { name: "Switch brokerage" }),
	).toHaveAttribute("href", "/?choose=1");
});

test("sign out", async ({ page }) => {
	const state = newState();
	await mockApi(page, state);
	await page.goto(TASKS);
	await expect(page.getByText("No tasks yet.")).toBeVisible();
	await page.getByRole("button", { name: "Sign out" }).click();
	await expect(
		page.getByRole("heading", { name: "Sign in to Real Estate Ops" }),
	).toBeVisible();
	expect(
		state.requests.some(
			(r) => r.method === "POST" && r.path === "/auth/logout",
		),
	).toBe(true);
});

test("keyboard only", async ({ page }) => {
	const state = newState();
	await mockApi(page, state);
	await page.goto(TASKS);
	await expect(page.getByText("No tasks yet.")).toBeVisible();
	const title = page.getByLabel("Title");
	await tabTo(page, title);
	await expectFocusRing(title);
	await page.keyboard.type("Synthetic keyboard task");
	await page.keyboard.press("Tab");
	await expectFocusRing(page.getByLabel("Due (Toronto time)"));
	await tabTo(page, page.getByRole("button", { name: "Add task" }));
	await expectFocusRing(page.getByRole("button", { name: "Add task" }));
	await page.keyboard.press("Enter");
	await expect(page.getByRole("list", { name: "Tasks" })).toContainText(
		"Synthetic keyboard task",
	);
	expect(posts(state)).toHaveLength(1);
});
