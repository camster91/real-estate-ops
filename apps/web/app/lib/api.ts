// Small typed wrappers around the API. The website talks only to its own
// origin; next.config.ts proxies /auth and /v1 to the API. Never reads or
// writes the session cookie, and never renders raw API bodies.

export interface Membership {
	organizationId: string;
	name: string;
}

export interface Session {
	principalId: string;
	memberships: Membership[];
}

export interface Task {
	id: string;
	title: string;
	status: string;
	dueAt: string | null;
	version: number;
}

export interface NewTaskBody {
	id: string;
	title: string;
	dueAt?: string;
}

export type CreateResult =
	| { task: Task }
	| { invalid: string }
	| "signed_out"
	| "not_found"
	| "conflict"
	| "error";

const options: RequestInit = { credentials: "same-origin", cache: "no-store" };

const tasksPath = (organizationId: string) =>
	`/v1/organizations/${encodeURIComponent(organizationId)}/tasks`;

async function json(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

export async function getSession(): Promise<Session | "signed_out" | "error"> {
	try {
		const response = await fetch("/v1/session", options);
		if (response.status === 401) return "signed_out";
		if (!response.ok) return "error";
		const body = (await json(response)) as Session | undefined;
		return body && Array.isArray(body.memberships) ? body : "error";
	} catch {
		return "error";
	}
}

export async function listTasks(
	organizationId: string,
): Promise<Task[] | "signed_out" | "not_found" | "error"> {
	try {
		const response = await fetch(tasksPath(organizationId), options);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (!response.ok) return "error";
		const body = (await json(response)) as { tasks?: Task[] } | undefined;
		return Array.isArray(body?.tasks) ? body.tasks : "error";
	} catch {
		return "error";
	}
}

export async function createTask(
	organizationId: string,
	task: NewTaskBody,
): Promise<CreateResult> {
	try {
		const response = await fetch(tasksPath(organizationId), {
			...options,
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(task),
		});
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (response.status === 409) return "conflict";
		const body = (await json(response)) as
			| { task?: Task; error?: string; field?: string }
			| undefined;
		if (response.status === 400 && body?.error === "invalid_task")
			return { invalid: body.field ?? "body" };
		if (response.ok && body?.task) return { task: body.task };
		return "error";
	} catch {
		return "error";
	}
}

export async function signOut(): Promise<void> {
	try {
		await fetch("/auth/logout", { ...options, method: "POST" });
	} catch {
		// The page goes to sign-in either way.
	}
}

export const LAST_ORGANIZATION = "reo.lastOrganization";

export function rememberOrganization(organizationId: string): void {
	try {
		localStorage.setItem(LAST_ORGANIZATION, organizationId);
	} catch {
		// Storage can be unavailable (private mode); remembering is optional.
	}
}

export function rememberedOrganization(): string | null {
	try {
		return localStorage.getItem(LAST_ORGANIZATION);
	} catch {
		return null;
	}
}
