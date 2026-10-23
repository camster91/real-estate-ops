"use client";

import {
	formatInZone,
	KEY_DATE_KIND_LABELS,
	KEY_DATE_KINDS,
	type KeyDateKind,
	keyDateState,
	needsLabel,
	TORONTO,
	toOffsetIso,
	zonedLocalToUtc,
} from "@reo/domain";
import Link from "next/link";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type KeyDate,
	type KeyDateUpdateBody,
	listKeyDates,
	saveKeyDate,
} from "../../../../lib/api";

const kindLabel = (kind: string) =>
	KEY_DATE_KIND_LABELS[kind as KeyDateKind] ?? kind;
const title = (date: KeyDate) => date.label ?? kindLabel(date.kind);
const byDue = (a: KeyDate, b: KeyDate) =>
	a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);
/** The value of a datetime-local input, in Toronto time. */
const localValue = (iso: string) =>
	toOffsetIso(new Date(iso), TORONTO).slice(0, 16);

const LABEL_ERROR =
	"Name it, like Financing or Home inspection (up to 100 characters).";
const DUE_ERROR = "Enter a date and time between 2000 and 2100.";
const GAP_ERROR =
	"That time does not exist in Toronto (the clocks spring forward). Choose another time.";
const SAVE_ERROR = "That could not be saved. Please try again.";
const LIMIT_ERROR = "This deal already has 200 key dates.";
const CHANGED =
	"This date was changed in another window. The latest is shown; check it and save again.";
const SIGNED_OUT = "Your session has ended. Sign in again, then try again.";
const STATE_TEXT = {
	overdue: "Overdue",
	due_soon: "Due soon",
	upcoming: "Upcoming",
};

type Errors = Partial<Record<"label" | "dueAt", string>>;

/** Reads a datetime-local value as Toronto time; an error message if it fails. */
function toDueAt(local: string): { dueAt: string } | { error: string } {
	if (!local) return { error: DUE_ERROR };
	const instant = zonedLocalToUtc(local, TORONTO);
	if (instant === "invalid") return { error: DUE_ERROR };
	if (instant === "nonexistent") return { error: GAP_ERROR };
	return { dueAt: toOffsetIso(instant, TORONTO) };
}

type Outcome =
	| { saved: KeyDate }
	| { conflict: KeyDate }
	| { invalid: string }
	| { failed: string };

/** Key dates on one deal: list, add, mark done and change (ADR 0022). */
export function KeyDates(props: {
	organizationId: string;
	dealId: string;
	announce: (text: string) => void;
	onNotFound: () => void;
}) {
	const { organizationId, dealId, announce, onNotFound } = props;
	const [dates, setDates] = useState<KeyDate[] | "loading" | "error">(
		"loading",
	);
	const [signedOut, setSignedOut] = useState(false);
	// One save at a time per row, and the add form on its own.
	const [busyRow, setBusyRow] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [messages, setMessages] = useState<Record<string, string>>({});
	// States move on with time: re-render every minute.
	const [now, setNow] = useState(() => new Date());
	// Add form
	const [kind, setKind] = useState<string>("condition");
	const [label, setLabel] = useState("");
	const [due, setDue] = useState("");
	const [errors, setErrors] = useState<Errors>({});
	const [formError, setFormError] = useState<string>();
	const pendingId = useRef<string | null>(null);
	const labelInput = useRef<HTMLInputElement>(null);
	const dueInput = useRef<HTMLInputElement>(null);
	// Edit form, for one date at a time
	const [editing, setEditing] = useState<string | null>(null);
	const [editLabel, setEditLabel] = useState("");
	const [editDue, setEditDue] = useState("");
	const [editErrors, setEditErrors] = useState<Errors>({});
	const editLabelInput = useRef<HTMLInputElement>(null);
	const editDueInput = useRef<HTMLInputElement>(null);
	// Where focus returns after an edit closes.
	const changeButtons = useRef<Record<string, HTMLButtonElement | null>>({});

	const load = useCallback(async () => {
		setDates("loading");
		const result = await listKeyDates(organizationId, dealId);
		if (result === "signed_out") return setSignedOut(true);
		if (result === "not_found") return onNotFound();
		setDates(result === "error" ? "error" : [...result].sort(byDue));
	}, [organizationId, dealId, onNotFound]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(timer);
	}, []);

	const put = (date: KeyDate) =>
		setDates((current) =>
			Array.isArray(current)
				? [...current.filter((d) => d.id !== date.id), date].sort(byDue)
				: current,
		);
	const note = (id: string, text?: string) =>
		setMessages((current) => {
			const next = { ...current };
			if (text) next[id] = text;
			else delete next[id];
			return next;
		});

	const add = async (event: FormEvent) => {
		event.preventDefault();
		if (adding) return;
		setErrors({});
		setFormError(undefined);
		setSignedOut(false);
		announce("");
		const found: Errors = {};
		if (needsLabel(kind as KeyDateKind) && !label.trim())
			found.label = LABEL_ERROR;
		const when = toDueAt(due);
		if ("error" in when) found.dueAt = when.error;
		if (found.label || found.dueAt || "error" in when) {
			setErrors(found);
			(found.label ? labelInput : dueInput).current?.focus();
			return;
		}
		pendingId.current ??= crypto.randomUUID();
		setAdding(true);
		const result = await saveKeyDate(organizationId, dealId, {
			id: pendingId.current,
			kind,
			...(label.trim() ? { label } : {}),
			dueAt: when.dueAt,
		});
		setAdding(false);
		if (result === "signed_out") return setSignedOut(true);
		if (result === "not_found") return onNotFound();
		if (result === "error") return setFormError(SAVE_ERROR);
		if (result === "limit") return setFormError(LIMIT_ERROR);
		if (result === "conflict" || "conflict" in result) {
			// The same id with other details: an earlier try may have been saved.
			pendingId.current = null;
			await load();
			return setFormError(
				"An earlier try may already be saved. Check the list, then add again if needed.",
			);
		}
		if ("invalid" in result) {
			if (result.invalid === "label") {
				setErrors({ label: LABEL_ERROR });
				labelInput.current?.focus();
			} else if (result.invalid === "dueAt") {
				setErrors({ dueAt: DUE_ERROR });
				dueInput.current?.focus();
			} else {
				pendingId.current = null;
				setFormError(SAVE_ERROR);
			}
			return;
		}
		pendingId.current = null;
		put(result.keyDate);
		setLabel("");
		setDue("");
		announce("Key date added.");
	};

	/** Saves one change to a date; the caller decides what the screen does. */
	const update = async (
		date: KeyDate,
		changes: Omit<KeyDateUpdateBody, "version">,
	): Promise<Outcome | null> => {
		if (busyRow) return null;
		note(date.id);
		setSignedOut(false);
		announce("");
		setBusyRow(date.id);
		const result = await saveKeyDate(
			organizationId,
			dealId,
			{ version: date.version, ...changes },
			date.id,
		);
		setBusyRow(null);
		if (result === "signed_out") {
			setSignedOut(true);
			return { failed: SIGNED_OUT };
		}
		if (result === "not_found") {
			onNotFound();
			return null;
		}
		if (typeof result === "string") return { failed: SAVE_ERROR };
		if ("conflict" in result) {
			put(result.conflict);
			return { conflict: result.conflict };
		}
		if ("invalid" in result) return { invalid: result.invalid };
		put(result.keyDate);
		return { saved: result.keyDate };
	};

	const toggle = async (date: KeyDate) => {
		const outcome = await update(date, {
			label: date.label,
			dueAt: date.dueAt,
			done: !date.doneAt,
		});
		if (!outcome) return;
		if ("saved" in outcome)
			return announce(
				`${title(outcome.saved)} marked ${outcome.saved.doneAt ? "done" : "not done"}.`,
			);
		note(date.id, "conflict" in outcome ? CHANGED : SAVE_ERROR);
	};

	const closeEdit = (id: string) => {
		setEditing(null);
		requestAnimationFrame(() => changeButtons.current[id]?.focus());
	};

	const fillEdit = (date: KeyDate) => {
		setEditLabel(date.label ?? "");
		setEditDue(localValue(date.dueAt));
	};

	const startEdit = (date: KeyDate) => {
		setEditing(date.id);
		fillEdit(date);
		setEditErrors({});
		note(date.id);
		requestAnimationFrame(() => editDueInput.current?.focus());
	};

	const saveEdit = async (event: FormEvent, date: KeyDate) => {
		event.preventDefault();
		setEditErrors({});
		const found: Errors = {};
		if (needsLabel(date.kind as KeyDateKind) && !editLabel.trim())
			found.label = LABEL_ERROR;
		// An untouched due time is sent exactly as stored, so a repeated
		// fall-back hour or stored seconds never shift it.
		const when =
			editDue === localValue(date.dueAt)
				? { dueAt: date.dueAt }
				: toDueAt(editDue);
		if ("error" in when) found.dueAt = when.error;
		if (found.label || found.dueAt || "error" in when) {
			setEditErrors(found);
			(found.label ? editLabelInput : editDueInput).current?.focus();
			return;
		}
		const outcome = await update(date, {
			label: editLabel.trim() ? editLabel : null,
			dueAt: when.dueAt,
			done: Boolean(date.doneAt),
		});
		if (!outcome) return;
		if ("saved" in outcome) {
			closeEdit(date.id);
			return announce(`${title(outcome.saved)} saved.`);
		}
		// Keep the form open so nothing typed is lost.
		if ("conflict" in outcome) {
			fillEdit(outcome.conflict);
			note(date.id, CHANGED);
			return editDueInput.current?.focus();
		}
		if ("invalid" in outcome && outcome.invalid === "label") {
			setEditErrors({ label: LABEL_ERROR });
			return editLabelInput.current?.focus();
		}
		if ("invalid" in outcome && outcome.invalid === "dueAt") {
			setEditErrors({ dueAt: DUE_ERROR });
			return editDueInput.current?.focus();
		}
		note(date.id, "failed" in outcome ? outcome.failed : SAVE_ERROR);
	};

	return (
		<section aria-labelledby="key-dates-heading">
			<h2 id="key-dates-heading">Key dates</h2>
			{signedOut && (
				<p role="alert" className="error">
					Your session has ended. <Link href="/">Sign in</Link> again, then try
					again.
				</p>
			)}
			{dates === "loading" && <p role="status">Loading key dates…</p>}
			{dates === "error" && (
				<div className="notice">
					<p>Key dates could not be loaded.</p>
					<button type="button" className="button" onClick={load}>
						Try again
					</button>
				</div>
			)}
			{Array.isArray(dates) &&
				(dates.length === 0 ? (
					<p>No key dates yet.</p>
				) : (
					<ul className="tasks key-dates" aria-label="Key dates">
						{dates.map((date) => {
							const state = keyDateState(date.dueAt, date.doneAt, now);
							const dueText = formatInZone(date.dueAt, TORONTO, now);
							// Unique even for two unnamed deposits.
							const name = `${title(date)}, due ${dueText}`;
							const messageId = `key-date-${date.id}-message`;
							return (
								<li key={date.id} data-state={state}>
									<span className="title">{title(date)}</span>
									<span className="meta">
										{[
											date.label ? kindLabel(date.kind) : null,
											`Due ${dueText}`,
											date.doneAt
												? `Done ${formatInZone(date.doneAt, TORONTO, now)}`
												: STATE_TEXT[state as keyof typeof STATE_TEXT],
										]
											.filter(Boolean)
											.join(" · ")}
									</span>
									{messages[date.id] && (
										<p id={messageId} role="alert" className="error">
											{messages[date.id]}
										</p>
									)}
									{editing === date.id ? (
										<form
											className="add inline"
											aria-label={`Change ${name}`}
											onSubmit={(event) => saveEdit(event, date)}
											noValidate
										>
											<label htmlFor={`edit-label-${date.id}`}>
												Name
												{needsLabel(date.kind as KeyDateKind)
													? ""
													: " (optional)"}
											</label>
											<input
												id={`edit-label-${date.id}`}
												ref={editLabelInput}
												value={editLabel}
												maxLength={100}
												onChange={(event) => setEditLabel(event.target.value)}
												aria-invalid={editErrors.label ? true : undefined}
												aria-describedby={
													editErrors.label
														? `edit-label-${date.id}-error`
														: undefined
												}
											/>
											{editErrors.label && (
												<p id={`edit-label-${date.id}-error`} className="error">
													{editErrors.label}
												</p>
											)}
											<label htmlFor={`edit-due-${date.id}`}>
												Due (Toronto time)
											</label>
											<input
												id={`edit-due-${date.id}`}
												ref={editDueInput}
												type="datetime-local"
												value={editDue}
												onChange={(event) => setEditDue(event.target.value)}
												aria-invalid={editErrors.dueAt ? true : undefined}
												aria-describedby={
													editErrors.dueAt
														? `edit-due-${date.id}-error`
														: undefined
												}
											/>
											{editErrors.dueAt && (
												<p id={`edit-due-${date.id}-error`} className="error">
													{editErrors.dueAt}
												</p>
											)}
											<div className="actions-row">
												<button
													type="submit"
													className="button"
													disabled={busyRow === date.id}
													aria-label={`Save ${title(date)}`}
												>
													Save date
												</button>
												<button
													type="button"
													className="link"
													onClick={() => closeEdit(date.id)}
												>
													Cancel
												</button>
											</div>
										</form>
									) : (
										<div className="actions-row">
											<button
												type="button"
												className="link"
												disabled={busyRow === date.id}
												aria-label={`${date.doneAt ? "Mark not done" : "Mark done"}: ${name}`}
												aria-describedby={
													messages[date.id] ? messageId : undefined
												}
												onClick={() => toggle(date)}
											>
												{date.doneAt ? "Mark not done" : "Mark done"}
											</button>
											<button
												type="button"
												className="link"
												ref={(element) => {
													changeButtons.current[date.id] = element;
												}}
												disabled={busyRow === date.id}
												aria-label={`Change: ${name}`}
												onClick={() => startEdit(date)}
											>
												Change
											</button>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				))}
			<form className="add" onSubmit={add} noValidate>
				<h3>Add a key date</h3>
				<label htmlFor="key-date-kind">Type</label>
				<select
					id="key-date-kind"
					className="status"
					value={kind}
					onChange={(event) => setKind(event.target.value)}
				>
					{KEY_DATE_KINDS.map((value) => (
						<option key={value} value={value}>
							{KEY_DATE_KIND_LABELS[value]}
						</option>
					))}
				</select>
				<label htmlFor="key-date-label">
					Name{needsLabel(kind as KeyDateKind) ? "" : " (optional)"}
				</label>
				<input
					id="key-date-label"
					ref={labelInput}
					value={label}
					maxLength={100}
					placeholder={kind === "condition" ? "Financing" : undefined}
					onChange={(event) => setLabel(event.target.value)}
					aria-invalid={errors.label ? true : undefined}
					aria-describedby={errors.label ? "key-date-label-error" : undefined}
				/>
				{errors.label && (
					<p id="key-date-label-error" className="error">
						{errors.label}
					</p>
				)}
				<label htmlFor="key-date-due">Due (Toronto time)</label>
				<input
					id="key-date-due"
					ref={dueInput}
					type="datetime-local"
					min="2000-01-01T00:00"
					max="2100-12-31T23:59"
					value={due}
					onChange={(event) => setDue(event.target.value)}
					aria-invalid={errors.dueAt ? true : undefined}
					aria-describedby={errors.dueAt ? "key-date-due-error" : undefined}
				/>
				{errors.dueAt && (
					<p id="key-date-due-error" className="error">
						{errors.dueAt}
					</p>
				)}
				{formError && (
					<p role="alert" className="error">
						{formError}
					</p>
				)}
				<button type="submit" className="button" disabled={adding}>
					Add key date
				</button>
			</form>
		</section>
	);
}
