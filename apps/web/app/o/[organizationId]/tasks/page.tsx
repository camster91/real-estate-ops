"use client";

import {
	formatInZone,
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
	createTask,
	listTasks,
	type NewTaskBody,
	rememberOrganization,
	signOut,
	type Task,
} from "../../../lib/api";

const STATUS_LABELS: Record<string, string> = {
	ready: "Ready",
	in_progress: "In progress",
	waiting: "Waiting",
	blocked: "Blocked",
	completed: "Completed",
	cancelled: "Cancelled",
};

const TITLE_ERROR = "Enter a title of 1 to 200 characters without line breaks.";
const DATE_ERROR = "Enter a valid date and time.";
const GAP_ERROR =
	"That time does not exist in Toronto (clocks change). Pick another time.";
const SAVE_ERROR = "That task could not be saved. Please try again.";
const SESSION_ENDED =
	"Your session has ended. Sign in again, then add this task.";

type Load = "loading" | "ready" | "error" | "not_found";

// Undated tasks last, then by due date, as the API orders them.
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
			pendingId.current = null;
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
						{tasks.length === 0 ? (
							<p>No tasks yet. Add your first task below.</p>
						) : (
							<ul className="tasks" aria-label="Tasks">
								{tasks.map((task) => (
									<li key={task.id}>
										<span className="title">{task.title}</span>
										<span className="meta">
											{STATUS_LABELS[task.status] ?? task.status}
											{" · "}
											{task.dueAt
												? formatInZone(task.dueAt, TORONTO)
												: "No due date"}
										</span>
									</li>
								))}
							</ul>
						)}
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
					</>
				)}
				<p role="status" aria-live="polite" className="visually-hidden">
					{announcement}
				</p>
			</main>
		</>
	);
}
