"use client";

import {
	DONE_STATUSES,
	TORONTO,
	toOffsetIso,
	zonedLocalToUtc,
} from "@reo/domain";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	changeStatus,
	createTask,
	listTasks,
	type NewTaskBody,
	rememberOrganization,
	signOut,
	type Task,
} from "../../../lib/api";
import {
	DoneTasks,
	OpenTasks,
	type RowMessage,
	STATUS_LABELS,
} from "./task-lists";

const TITLE_ERROR = "Enter a title of 1 to 200 characters without line breaks.";
const DATE_ERROR = "Enter a valid date and time.";
const GAP_ERROR =
	"That time does not exist in Toronto (clocks change). Pick another time.";
const SAVE_ERROR = "That task could not be saved. Please try again.";
const ALREADY_SAVED =
	"Your earlier task was already saved. Press Add task again to add this one as well.";
const SESSION_ENDED =
	"Your session has ended. Sign in again, then add this task.";
const STATUS_CONFLICT =
	"This task changed in another window. It now shows the latest status.";
const STATUS_ERROR = "The status could not be changed. Please try again.";
const STATUS_SIGNED_OUT = "Your session has ended. Sign in again to change it.";

const isDone = (status: string) =>
	(DONE_STATUSES as readonly string[]).includes(status);
const without = (list: Task[], id: string) =>
	list.filter((task) => task.id !== id);

type Load = "loading" | "ready" | "error" | "not_found";

// Open tasks: undated last, then by due date, as the API orders them.
const byDue = (a: Task, b: Task) =>
	(a.dueAt === null ? 1 : 0) - (b.dueAt === null ? 1 : 0) ||
	(a.dueAt ?? "").localeCompare(b.dueAt ?? "");

export default function MyTasks() {
	const router = useRouter();
	const { organizationId } = useParams<{ organizationId: string }>();
	const [load, setLoad] = useState<Load>("loading");
	const [tasks, setTasks] = useState<Task[]>([]);
	const [title, setTitle] = useState("");
	const [due, setDue] = useState("");
	const [titleError, setTitleError] = useState<string>();
	const [dueError, setDueError] = useState<string>();
	const [formError, setFormError] = useState<string>();
	const [sessionEnded, setSessionEnded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	// Finished tasks, loaded when first shown; null until then.
	const [done, setDone] = useState<Task[] | "loading" | "error" | null>(null);
	const [showDone, setShowDone] = useState(false);
	// Rows with a status change in flight, the value being sent, and messages.
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [pending, setPending] = useState<Record<string, string>>({});
	const [messages, setMessages] = useState<Record<string, RowMessage>>({});
	// One id per submission: retries reuse it, so the API replays instead of
	// creating a second task. A new id is made only after a success.
	const pendingId = useRef<string | null>(null);
	const titleInput = useRef<HTMLInputElement>(null);
	const dueInput = useRef<HTMLInputElement>(null);

	const refresh = useCallback(async () => {
		setLoad("loading");
		const result = await listTasks(organizationId);
		if (result === "signed_out") return router.replace("/");
		if (result === "not_found" || result === "error") return setLoad(result);
		rememberOrganization(organizationId);
		setTasks(result);
		setLoad("ready");
	}, [organizationId, router]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		setTitleError(undefined);
		setDueError(undefined);
		setFormError(undefined);
		setSessionEnded(false);
		setAnnouncement("");
		let dueAt: string | undefined;
		if (due) {
			const instant = zonedLocalToUtc(due, TORONTO);
			if (!(instant instanceof Date)) {
				setDueError(instant === "nonexistent" ? GAP_ERROR : DATE_ERROR);
				dueInput.current?.focus();
				return;
			}
			dueAt = toOffsetIso(instant, TORONTO);
		}
		pendingId.current ??= crypto.randomUUID();
		const body: NewTaskBody = { id: pendingId.current, title };
		if (dueAt) body.dueAt = dueAt;
		setSaving(true);
		const result = await createTask(organizationId, body);
		setSaving(false);
		if (result === "signed_out") return setSessionEnded(true);
		if (result === "not_found") return setLoad("not_found");
		if (result === "error") return setFormError(SAVE_ERROR);
		if (result === "conflict") {
			// The same id with a different body: an earlier try may have been
			// saved with its reply lost. Show the saved list, and use a new id.
			const sent = pendingId.current;
			pendingId.current = null;
			const latest = await listTasks(organizationId);
			if (Array.isArray(latest)) {
				setTasks(latest);
				if (latest.some((task) => task.id === sent))
					return setFormError(ALREADY_SAVED);
			}
			return setFormError(SAVE_ERROR);
		}
		if ("invalid" in result) {
			if (result.invalid === "title") {
				setTitleError(TITLE_ERROR);
				titleInput.current?.focus();
			} else if (result.invalid === "dueAt") {
				setDueError(DATE_ERROR);
				dueInput.current?.focus();
			} else {
				pendingId.current = null;
				setFormError(SAVE_ERROR);
			}
			return;
		}
		pendingId.current = null;
		const added = result.task;
		setTasks((current) =>
			[...current.filter((task) => task.id !== added.id), added].sort(byDue),
		);
		setTitle("");
		setDue("");
		setAnnouncement("Task added.");
	};

	const loadDone = useCallback(async () => {
		setDone("loading");
		const result = await listTasks(organizationId, "done");
		if (result === "signed_out") return router.replace("/");
		setDone(Array.isArray(result) ? result : "error");
	}, [organizationId, router]);

	const toggleDone = () => {
		const next = !showDone;
		setShowDone(next);
		if (next && done === null) loadDone();
	};

	/** Puts a task in the open or done list, according to its status. */
	const place = (task: Task) => {
		setTasks((current) => {
			const rest = without(current, task.id);
			return isDone(task.status) ? rest : [...rest, task].sort(byDue);
		});
		setDone((current) => {
			if (!Array.isArray(current)) return current;
			const rest = without(current, task.id);
			return isDone(task.status) ? [task, ...rest] : rest;
		});
	};

	const setStatus = async (task: Task, status: string) => {
		if (busy.has(task.id)) return;
		setBusy((current) => new Set(current).add(task.id));
		setPending((current) => ({ ...current, [task.id]: status }));
		setMessages(({ [task.id]: _, ...rest }) => rest);
		setAnnouncement("");
		const result = await changeStatus(
			organizationId,
			task.id,
			status,
			task.version,
		);
		setBusy((current) => {
			const next = new Set(current);
			next.delete(task.id);
			return next;
		});
		setPending(({ [task.id]: _, ...rest }) => rest);
		const say = (message: RowMessage) =>
			setMessages((current) => ({ ...current, [task.id]: message }));
		if (result === "not_found") return refresh();
		if (result === "signed_out")
			return say({ text: STATUS_SIGNED_OUT, signIn: true });
		if (result === "error") return say({ text: STATUS_ERROR });
		if ("conflict" in result) {
			place(result.conflict);
			say({ text: STATUS_CONFLICT });
			return setAnnouncement(STATUS_CONFLICT);
		}
		place(result.task);
		if (isDone(task.status)) return setAnnouncement("Task reopened.");
		if (result.task.status === "completed")
			return setAnnouncement("Task marked done.");
		if (result.task.status === "cancelled")
			return setAnnouncement("Task cancelled.");
		setAnnouncement(
			`Status changed to ${STATUS_LABELS[result.task.status] ?? result.task.status}.`,
		);
	};

	const leave = async () => {
		await signOut();
		router.replace("/");
	};

	return (
		<>
			<header className="bar">
				<span className="eyebrow">Real Estate Ops</span>
				<nav aria-label="Account">
					<Link href="/?choose=1">Switch brokerage</Link>
					<button type="button" className="link" onClick={leave}>
						Sign out
					</button>
				</nav>
			</header>
			<main id="main" tabIndex={-1}>
				<h1>My tasks</h1>
				{load === "loading" && <p role="status">Loading tasks…</p>}
				{load === "error" && (
					<div role="alert" className="notice">
						<p>Tasks could not be loaded.</p>
						<button type="button" className="button" onClick={refresh}>
							Try again
						</button>
					</div>
				)}
				{load === "not_found" && (
					<div role="alert" className="notice">
						<p>This brokerage is not available to you.</p>
						<Link href="/?choose=1">Switch brokerage</Link>
					</div>
				)}
				{load === "ready" && (
					<>
						<OpenTasks
							tasks={tasks}
							busy={busy}
							pending={pending}
							messages={messages}
							onChange={setStatus}
						/>
						<form className="add" onSubmit={submit} noValidate>
							<h2>Add a task</h2>
							<label htmlFor="title">Title</label>
							<input
								id="title"
								ref={titleInput}
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								required
								maxLength={200}
								aria-invalid={titleError ? true : undefined}
								aria-describedby={titleError ? "title-error" : undefined}
							/>
							{titleError && (
								<p id="title-error" className="error">
									{titleError}
								</p>
							)}
							<label htmlFor="due">Due (Toronto time)</label>
							<input
								id="due"
								type="datetime-local"
								ref={dueInput}
								value={due}
								onChange={(event) => setDue(event.target.value)}
								aria-invalid={dueError ? true : undefined}
								aria-describedby={dueError ? "due-error" : undefined}
							/>
							{dueError && (
								<p id="due-error" className="error">
									{dueError}
								</p>
							)}
							{formError && (
								<p role="alert" className="error">
									{formError}
								</p>
							)}
							{sessionEnded && (
								<p role="alert" className="error">
									{SESSION_ENDED} <Link href="/">Sign in</Link>
								</p>
							)}
							<button type="submit" className="button" disabled={saving}>
								Add task
							</button>
						</form>
						<h2>Done tasks</h2>
						<button
							type="button"
							className="link"
							aria-expanded={showDone}
							aria-controls="done-tasks"
							onClick={toggleDone}
						>
							{showDone ? "Hide done tasks" : "Show done tasks"}
						</button>
						<div id="done-tasks" hidden={!showDone}>
							{showDone && done !== null && (
								<DoneTasks
									state={done}
									busy={busy}
									messages={messages}
									onReopen={(task) => setStatus(task, "ready")}
									onRetry={loadDone}
								/>
							)}
						</div>
					</>
				)}
				<p role="status" aria-live="polite" className="visually-hidden">
					{announcement}
				</p>
			</main>
		</>
	);
}
