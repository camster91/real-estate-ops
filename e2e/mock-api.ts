// Browser-level API mocks for the screen tests. The website's own pages are
// real; every /auth and /v1 request is answered here, so no API or database
// is needed. Synthetic data only.
import { expect, type Locator, type Page } from "@playwright/test";

export const ORG_A = "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a";
export const ORG_B = "5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
export const MEMBER_A = { organizationId: ORG_A, name: "Synthetic Org A" };
export const MEMBER_B = { organizationId: ORG_B, name: "Synthetic Org B" };

export interface MockTask {
	id: string;
	title: string;
	status: string;
	dueAt: string | null;
	version: number;
	statusChangedAt: string;
}

const DONE = ["completed", "cancelled"];
// Same rules as @reo/domain canTransition (ADR 0017).
const allowed = (from: string, to: string) =>
	from !== to && (!DONE.includes(from) || to === "ready");

// "commit_then_abort": the task is saved, but the response is lost.
type Reply = { status: number; body?: unknown } | "abort" | "commit_then_abort";

export interface MockState {
	/** Signed out, or the session's memberships. */
	session: "signed_out" | { organizationId: string; name: string }[];
	/** Per organisation: its tasks, or how the list call fails. */
	tasks: Record<string, MockTask[] | "signed_out" | "not_found" | "error">;
	/** Delay for the list call, in milliseconds. */
	listDelay?: number;
	/** Replies for the next create calls, in order; then a normal success. */
	createReplies: Reply[];
	/** Replies for the next status changes, in order; then the normal rules. */
	patchReplies: Reply[];
	/** Delay for status changes, in milliseconds. */
	patchDelay?: number;
	/** Status for POST /auth/logout; 204 (signed out) when unset. */
	logoutStatus?: number;
	/** Every API request, for assertions. */
	requests: { method: string; path: string; body: unknown }[];
}

export const newState = (overrides: Partial<MockState> = {}): MockState => ({
	session: [MEMBER_A],
	tasks: { [ORG_A]: [], [ORG_B]: [] },
	createReplies: [],
	patchReplies: [],
	requests: [],
	...overrides,
});

const LIST_FAILURES = {
	signed_out: { status: 401, body: { error: "authentication_required" } },
	not_found: { status: 404, body: { error: "not_found" } },
	error: { status: 500, body: { error: "internal" } },
};

export async function mockApi(page: Page, state: MockState): Promise<void> {
	await page.route(
		(url) => /^\/(v1|auth)\//.test(url.pathname),
		async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			const method = request.method();
			const body = request.postData() ? request.postDataJSON() : undefined;
			state.requests.push({ method, path: url.pathname, body });
			const reply = (status: number, json?: unknown) =>
				route.fulfill({
					status,
					contentType: "application/json",
					body: json === undefined ? "" : JSON.stringify(json),
				});

			if (url.pathname === "/v1/session")
				return state.session === "signed_out"
					? reply(401, { error: "authentication_required" })
					: reply(200, {
							principalId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
							memberships: state.session,
						});
			if (url.pathname === "/auth/logout" && method === "POST") {
				if (state.logoutStatus && state.logoutStatus !== 204)
					return reply(state.logoutStatus, { error: "internal" });
				state.session = "signed_out";
				return reply(204);
			}
			const one = /^\/v1\/organizations\/([^/]+)\/tasks\/([^/]+)$/.exec(
				url.pathname,
			);
			if (one && method === "PATCH") {
				if (state.patchDelay)
					await new Promise((done) => setTimeout(done, state.patchDelay));
				const next = state.patchReplies.shift();
				if (next === "abort") return route.abort("failed");
				if (next && next !== "commit_then_abort")
					return reply(next.status, next.body);
				const list = state.tasks[decodeURIComponent(one[1] as string)];
				const task = Array.isArray(list)
					? list.find((t) => t.id === one[2])
					: undefined;
				if (!task) return reply(404, { error: "not_found" });
				const change = body as { status: string; version: number };
				if (task.status === change.status) return reply(200, { task });
				if (task.version !== change.version)
					return reply(409, { error: "conflict", task });
				if (!allowed(task.status, change.status))
					return reply(409, { error: "invalid_transition", task });
				task.status = change.status;
				task.version += 1;
				task.statusChangedAt = new Date().toISOString();
				if (next === "commit_then_abort") return route.abort("failed");
				return reply(200, { task });
			}
			const tasks = /^\/v1\/organizations\/([^/]+)\/tasks$/.exec(url.pathname);
			if (tasks) {
				const org = decodeURIComponent(tasks[1] as string);
				const list = state.tasks[org] ?? "not_found";
				if (method === "GET") {
					// The reply is what the list held when the request arrived, even
					// if it is delayed: a slow response can be out of date.
					const done = url.searchParams.get("show") === "done";
					const snapshot =
						typeof list === "string"
							? list
							: list
									.filter((t) => DONE.includes(t.status) === done)
									.map((t) => ({ ...t }))
									.sort((a, b) =>
										done
											? b.statusChangedAt.localeCompare(a.statusChangedAt)
											: 0,
									);
					if (state.listDelay)
						await new Promise((wait) => setTimeout(wait, state.listDelay));
					if (typeof snapshot === "string") {
						const failure = LIST_FAILURES[snapshot];
						return reply(failure.status, failure.body);
					}
					return reply(200, { tasks: snapshot });
				}
				if (method === "POST") {
					const next = state.createReplies.shift();
					if (next === "abort") return route.abort("failed");
					if (next && next !== "commit_then_abort")
						return reply(next.status, next.body);
					const input = body as { id: string; title: string; dueAt?: string };
					const task: MockTask = {
						id: input.id,
						title: input.title.trim(),
						status: "ready",
						dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
						version: 1,
						statusChangedAt: new Date().toISOString(),
					};
					// Like the API: the same id replays, or conflicts if the body differs.
					const existing = Array.isArray(list)
						? list.find((t) => t.id === task.id)
						: undefined;
					if (existing)
						return existing.title === task.title &&
							existing.dueAt === task.dueAt
							? reply(200, { task: existing })
							: reply(409, { error: "conflict" });
					if (Array.isArray(list)) list.push(task);
					if (next === "commit_then_abort") return route.abort("failed");
					return reply(201, { task });
				}
			}
			return reply(404, { error: "not_found" });
		},
	);
}

/** The page never scrolls sideways at this viewport. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
}

/** The element has focus and a visible focus outline. */
export async function expectFocusRing(locator: Locator): Promise<void> {
	await expect(locator).toBeFocused();
	const outline = await locator.evaluate((element) => {
		const style = getComputedStyle(element);
		return { style: style.outlineStyle, width: style.outlineWidth };
	});
	expect(outline.style).not.toBe("none");
	expect(outline.width).not.toBe("0px");
}

/** Presses Tab until `locator` has focus (at most `limit` times). */
export async function tabTo(
	page: Page,
	locator: Locator,
	limit = 15,
): Promise<void> {
	for (let i = 0; i < limit; i++) {
		if (await locator.evaluate((element) => element === document.activeElement))
			return;
		await page.keyboard.press("Tab");
	}
	await expect(locator).toBeFocused();
}
