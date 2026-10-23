"use client";

import { formatInZone, OPEN_STATUSES, TORONTO } from "@reo/domain";
import Link from "next/link";
import type { Task } from "../../../lib/api";

export const STATUS_LABELS: Record<string, string> = {
	ready: "Ready",
	in_progress: "In progress",
	waiting: "Waiting",
	blocked: "Blocked",
	completed: "Done",
	cancelled: "Cancelled",
};

const STATUS_CHOICES = [...OPEN_STATUSES, "completed", "cancelled"] as const;

/**
 * Accessible names for tasks: the title, or "<title> (2 of 3)" when several
 * tasks share it, so screen-reader users can tell the controls apart.
 */
function namesFor(tasks: Task[]): Map<string, string> {
	const total = new Map<string, number>();
	for (const task of tasks)
		total.set(task.title, (total.get(task.title) ?? 0) + 1);
	const seen = new Map<string, number>();
	const names = new Map<string, string>();
	for (const task of tasks) {
		const count = total.get(task.title) ?? 1;
		const index = (seen.get(task.title) ?? 0) + 1;
		seen.set(task.title, index);
		names.set(
			task.id,
			count > 1 ? `${task.title} (${index} of ${count})` : task.title,
		);
	}
	return names;
}

/** A short message shown under one task, e.g. after a conflict. */
export interface RowMessage {
	text: string;
	signIn?: boolean;
}

function Message({
	id,
	message,
}: {
	id: string;
	message: RowMessage | undefined;
}) {
	if (!message) return null;
	return (
		<p id={id} className="error row-message">
			{message.text}
			{message.signIn && (
				<>
					{" "}
					<Link href="/">Sign in</Link>
				</>
			)}
		</p>
	);
}

export function OpenTasks(props: {
	tasks: Task[];
	busy: ReadonlySet<string>;
	pending: Readonly<Record<string, string>>;
	messages: Readonly<Record<string, RowMessage>>;
	onChange: (task: Task, status: string) => void;
}) {
	const { tasks, busy, pending, messages, onChange } = props;
	if (tasks.length === 0) return <p>No open tasks. Add a task below.</p>;
	const names = namesFor(tasks);
	return (
		<ul className="tasks" aria-label="Tasks">
			{tasks.map((task) => {
				const messageId = `message-${task.id}`;
				return (
					<li key={task.id}>
						<span className="title">{task.title}</span>
						<span className="meta">
							{task.dueAt ? formatInZone(task.dueAt, TORONTO) : "No due date"}
						</span>
						<select
							id={`status-${task.id}`}
							className="status"
							aria-label={`Status of ${names.get(task.id)}`}
							value={pending[task.id] ?? task.status}
							disabled={busy.has(task.id)}
							aria-describedby={messages[task.id] ? messageId : undefined}
							onChange={(event) => onChange(task, event.target.value)}
						>
							{STATUS_CHOICES.map((status) => (
								<option key={status} value={status}>
									{STATUS_LABELS[status]}
								</option>
							))}
						</select>
						<Message id={messageId} message={messages[task.id]} />
					</li>
				);
			})}
		</ul>
	);
}

export function DoneTasks(props: {
	state: "loading" | "error" | Task[];
	busy: ReadonlySet<string>;
	messages: Readonly<Record<string, RowMessage>>;
	onReopen: (task: Task) => void;
	onRetry: () => void;
}) {
	const { state, busy, messages, onReopen, onRetry } = props;
	if (state === "loading") return <p role="status">Loading done tasks…</p>;
	if (state === "error")
		return (
			<div className="notice">
				<p>Done tasks could not be loaded.</p>
				<button type="button" className="button" onClick={onRetry}>
					Try again
				</button>
			</div>
		);
	if (state.length === 0) return <p>No done tasks yet.</p>;
	const names = namesFor(state);
	return (
		<ul className="tasks done" aria-label="Done tasks">
			{state.map((task) => {
				const messageId = `message-${task.id}`;
				return (
					<li key={task.id}>
						<span className="title">{task.title}</span>
						<span className="meta">
							{STATUS_LABELS[task.status] ?? task.status}
							{" · "}
							{formatInZone(task.statusChangedAt, TORONTO)}
						</span>
						<button
							type="button"
							className="link"
							aria-label={`Reopen ${names.get(task.id)}`}
							disabled={busy.has(task.id)}
							aria-describedby={messages[task.id] ? messageId : undefined}
							onClick={() => onReopen(task)}
						>
							Reopen
						</button>
						<Message id={messageId} message={messages[task.id]} />
					</li>
				);
			})}
		</ul>
	);
}
