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
	statusChangedAt: string;
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

export type StatusResult =
	| { task: Task }
	| { conflict: Task }
	| "signed_out"
	| "not_found"
	| "error";

/** Open tasks, or finished ones with `show: "done"`. */
export async function listTasks(
	organizationId: string,
	show?: "done",
): Promise<Task[] | "signed_out" | "not_found" | "error"> {
	try {
		const path = tasksPath(organizationId) + (show ? "?show=done" : "");
		const response = await fetch(path, options);
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

/**
 * Changes a task's status. A stale version or a refused transition comes back
 * as `conflict` with the task as it is now, so the screen can show it.
 */
export async function changeStatus(
	organizationId: string,
	taskId: string,
	status: string,
	version: number,
): Promise<StatusResult> {
	try {
		const response = await fetch(
			`${tasksPath(organizationId)}/${encodeURIComponent(taskId)}`,
			{
				...options,
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ status, version }),
			},
		);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		const body = (await json(response)) as { task?: Task } | undefined;
		if (response.status === 409 && body?.task) return { conflict: body.task };
		if (response.ok && body?.task) return { task: body.task };
		return "error";
	} catch {
		return "error";
	}
}

/** Ends the session. False when the server could not confirm it. */
export async function signOut(): Promise<boolean> {
	try {
		const response = await fetch("/auth/logout", {
			...options,
			method: "POST",
		});
		// 401: the session had already ended.
		return response.ok || response.status === 401;
	} catch {
		return false;
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

export interface Client {
	id: string;
	name: string;
	email: string | null;
	phone: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface NewClientBody {
	id: string;
	name: string;
	email?: string;
	phone?: string;
}

export type CreateClientResult =
	| { client: Client }
	| { invalid: string }
	| "signed_out"
	| "not_found"
	| "conflict"
	| "error";

const clientsPath = (organizationId: string) =>
	`/v1/organizations/${encodeURIComponent(organizationId)}/clients`;

/** The first 100 clients A to Z; `more` says there are others not shown. */
export async function listClients(
	organizationId: string,
): Promise<
	{ clients: Client[]; more: boolean } | "signed_out" | "not_found" | "error"
> {
	try {
		const response = await fetch(clientsPath(organizationId), options);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (!response.ok) return "error";
		const body = (await json(response)) as
			| { clients?: Client[]; more?: boolean }
			| undefined;
		return Array.isArray(body?.clients)
			? { clients: body.clients, more: body.more === true }
			: "error";
	} catch {
		return "error";
	}
}

export async function getClient(
	organizationId: string,
	clientId: string,
): Promise<Client | "signed_out" | "not_found" | "error"> {
	try {
		const response = await fetch(
			`${clientsPath(organizationId)}/${encodeURIComponent(clientId)}`,
			options,
		);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (!response.ok) return "error";
		const body = (await json(response)) as { client?: Client } | undefined;
		return body?.client ?? "error";
	} catch {
		return "error";
	}
}

export async function createClient(
	organizationId: string,
	client: NewClientBody,
): Promise<CreateClientResult> {
	try {
		const response = await fetch(clientsPath(organizationId), {
			...options,
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(client),
		});
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (response.status === 409) return "conflict";
		const body = (await json(response)) as
			| { client?: Client; error?: string; field?: string }
			| undefined;
		if (response.status === 400 && body?.error === "invalid_client")
			return { invalid: body.field ?? "body" };
		if (response.ok && body?.client) return { client: body.client };
		return "error";
	} catch {
		return "error";
	}
}

/** "(416) 555-0100" for 10-digit North American numbers; otherwise as stored. */
export function formatPhone(phone: string): string {
	const digits = phone.startsWith("+1") ? phone.slice(2) : phone;
	if (/^\d{10}$/.test(digits))
		return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
	return phone;
}

export interface ClientUpdateBody {
	version: number;
	name: string;
	email: string;
	phone: string;
}

export type UpdateClientResult =
	| { client: Client }
	| { conflict: Client }
	| { invalid: string }
	| "signed_out"
	| "not_found"
	| "error";

/** Saves edited details. A stale version comes back as the current client. */
export async function updateClient(
	organizationId: string,
	clientId: string,
	update: ClientUpdateBody,
): Promise<UpdateClientResult> {
	try {
		const response = await fetch(
			`${clientsPath(organizationId)}/${encodeURIComponent(clientId)}`,
			{
				...options,
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(update),
			},
		);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		const body = (await json(response)) as
			| { client?: Client; error?: string; field?: string }
			| undefined;
		if (response.status === 409 && body?.client)
			return { conflict: body.client };
		if (response.status === 400 && body?.error === "invalid_client")
			return { invalid: body.field ?? "body" };
		if (response.ok && body?.client) return { client: body.client };
		return "error";
	} catch {
		return "error";
	}
}

export interface ConsentEntry {
	id: string;
	purpose: string;
	status: string;
	method: string;
	recordedAt: string;
}

export interface ConsentState {
	current: {
		purpose: string;
		status: string | null;
		method: string | null;
		recordedAt: string | null;
	}[];
	history: ConsentEntry[];
}

const consentsPath = (organizationId: string, clientId: string) =>
	`${clientsPath(organizationId)}/${encodeURIComponent(clientId)}/consents`;

export async function getConsents(
	organizationId: string,
	clientId: string,
): Promise<ConsentState | "signed_out" | "not_found" | "error"> {
	try {
		const response = await fetch(
			consentsPath(organizationId, clientId),
			options,
		);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (!response.ok) return "error";
		const body = (await json(response)) as ConsentState | undefined;
		return Array.isArray(body?.current) && Array.isArray(body?.history)
			? body
			: "error";
	} catch {
		return "error";
	}
}

export async function recordConsent(
	organizationId: string,
	clientId: string,
	consent: { id: string; purpose: string; status: string; method: string },
): Promise<"saved" | "signed_out" | "not_found" | "conflict" | "error"> {
	try {
		const response = await fetch(consentsPath(organizationId, clientId), {
			...options,
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(consent),
		});
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (response.status === 409) return "conflict";
		return response.ok ? "saved" : "error";
	} catch {
		return "error";
	}
}

export interface Deal {
	id: string;
	side: string;
	stage: string;
	address: {
		street: string;
		unit: string | null;
		city: string;
		postalCode: string;
	};
	/** Linked clients; the name is null if the client is no longer visible. */
	clients: { id: string; name: string | null }[];
	version: number;
	createdAt: string;
	stageChangedAt: string;
}

export interface NewDealBody {
	id: string;
	side: string;
	address: { street: string; unit?: string; city: string; postalCode: string };
	clientIds: string[];
}

export type CreateDealResult =
	| { deal: Deal }
	| { invalid: string }
	| "signed_out"
	| "not_found"
	| "conflict"
	| "error";

export type StageResult =
	| { deal: Deal }
	| { conflict: Deal }
	| "signed_out"
	| "not_found"
	| "error";

const dealsPath = (organizationId: string) =>
	`/v1/organizations/${encodeURIComponent(organizationId)}/deals`;

/** The newest 100 deals; `more` says there are others not shown. */
export async function listDeals(
	organizationId: string,
): Promise<
	{ deals: Deal[]; more: boolean } | "signed_out" | "not_found" | "error"
> {
	try {
		const response = await fetch(dealsPath(organizationId), options);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (!response.ok) return "error";
		const body = (await json(response)) as
			| { deals?: Deal[]; more?: boolean }
			| undefined;
		return Array.isArray(body?.deals)
			? { deals: body.deals, more: body.more === true }
			: "error";
	} catch {
		return "error";
	}
}

export async function getDeal(
	organizationId: string,
	dealId: string,
): Promise<Deal | "signed_out" | "not_found" | "error"> {
	try {
		const response = await fetch(
			`${dealsPath(organizationId)}/${encodeURIComponent(dealId)}`,
			options,
		);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (!response.ok) return "error";
		const body = (await json(response)) as { deal?: Deal } | undefined;
		return body?.deal ?? "error";
	} catch {
		return "error";
	}
}

export async function createDeal(
	organizationId: string,
	deal: NewDealBody,
): Promise<CreateDealResult> {
	try {
		const response = await fetch(dealsPath(organizationId), {
			...options,
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(deal),
		});
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (response.status === 409) return "conflict";
		const body = (await json(response)) as
			| { deal?: Deal; error?: string; field?: string }
			| undefined;
		if (response.status === 400 && body?.error === "invalid_deal")
			return { invalid: body.field ?? "body" };
		if (response.ok && body?.deal) return { deal: body.deal };
		return "error";
	} catch {
		return "error";
	}
}

/** Moves a deal; a 409 (changed elsewhere, or not allowed) returns the latest. */
export async function changeStage(
	organizationId: string,
	dealId: string,
	stage: string,
	version: number,
): Promise<StageResult> {
	try {
		const response = await fetch(
			`${dealsPath(organizationId)}/${encodeURIComponent(dealId)}`,
			{
				...options,
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ stage, version }),
			},
		);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		const body = (await json(response)) as { deal?: Deal } | undefined;
		if (response.status === 409 && body?.deal) return { conflict: body.deal };
		if (response.ok && body?.deal) return { deal: body.deal };
		return "error";
	} catch {
		return "error";
	}
}

export interface KeyDate {
	id: string;
	kind: string;
	label: string | null;
	dueAt: string;
	doneAt: string | null;
	version: number;
}

export interface NewKeyDateBody {
	id: string;
	kind: string;
	label?: string;
	dueAt: string;
}

export interface KeyDateUpdateBody {
	version: number;
	label: string | null;
	dueAt: string;
	done: boolean;
}

export type SaveKeyDateResult =
	| { keyDate: KeyDate }
	| { conflict: KeyDate }
	| { invalid: string }
	| "signed_out"
	| "not_found"
	| "conflict"
	| "error";

const keyDatesPath = (organizationId: string, dealId: string) =>
	`${dealsPath(organizationId)}/${encodeURIComponent(dealId)}/key-dates`;

export async function listKeyDates(
	organizationId: string,
	dealId: string,
): Promise<KeyDate[] | "signed_out" | "not_found" | "error"> {
	try {
		const response = await fetch(keyDatesPath(organizationId, dealId), options);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		if (!response.ok) return "error";
		const body = (await json(response)) as { keyDates?: KeyDate[] } | undefined;
		return Array.isArray(body?.keyDates) ? body.keyDates : "error";
	} catch {
		return "error";
	}
}

/** Adds (POST) or changes (PATCH, with `keyDateId`) a key date. */
export async function saveKeyDate(
	organizationId: string,
	dealId: string,
	body: NewKeyDateBody | KeyDateUpdateBody,
	keyDateId?: string,
): Promise<SaveKeyDateResult> {
	try {
		const base = keyDatesPath(organizationId, dealId);
		const response = await fetch(
			keyDateId ? `${base}/${encodeURIComponent(keyDateId)}` : base,
			{
				...options,
				method: keyDateId ? "PATCH" : "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		if (response.status === 401) return "signed_out";
		if (response.status === 404) return "not_found";
		const parsed = (await json(response)) as
			| { keyDate?: KeyDate; error?: string; field?: string }
			| undefined;
		if (response.status === 409)
			return parsed?.keyDate ? { conflict: parsed.keyDate } : "conflict";
		if (response.status === 400 && parsed?.error === "invalid_key_date")
			return { invalid: parsed.field ?? "body" };
		if (response.ok && parsed?.keyDate) return { keyDate: parsed.keyDate };
		return "error";
	} catch {
		return "error";
	}
}
