"use client";

import {
	CONSENT_METHODS,
	CONSENT_PURPOSE_LABELS,
	CONSENT_WORDING_IS_PLACEHOLDER,
	type ConsentPurpose,
	formatInZone,
	TORONTO,
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
	type Client,
	type ConsentState,
	formatPhone,
	getClient,
	getConsents,
	recordConsent,
	updateClient,
} from "../../../../lib/api";
import { AppHeader } from "../../app-header";

type View = Client | "loading" | "not_found" | "error";
type Field = "name" | "email" | "phone";

const FIELD_ERRORS: Record<Field, string> = {
	name: "Enter a name of 1 to 200 characters without line breaks.",
	email: "Enter a valid email address, like name@example.com.",
	phone: "Enter a phone number with 7 to 15 digits.",
};
const EDIT_CONFLICT =
	"This client was changed in another window. The latest details are shown; check them and save again.";
const SAVE_ERROR = "The changes could not be saved. Please try again.";
const SIGNED_OUT = "Your session has ended. Sign in again, then save.";
const CONSENT_ERROR = "That could not be recorded. Please try again.";
const CONSENT_CONFLICT =
	"That may already be recorded. Check the history below before trying again.";
const METHOD_LABELS: Record<string, string> = {
	written: "Written",
	electronic: "Electronic",
	verbal: "Verbal",
};
const STATUS_LABELS: Record<string, string> = {
	granted: "Given",
	withdrawn: "Withdrawn",
};

const label = (purpose: string) =>
	CONSENT_PURPOSE_LABELS[purpose as ConsentPurpose] ?? purpose;

export default function ClientDetail() {
	const router = useRouter();
	const { organizationId, clientId } = useParams<{
		organizationId: string;
		clientId: string;
	}>();
	const [view, setView] = useState<View>("loading");
	const [announcement, setAnnouncement] = useState("");

	// Editing
	const [editing, setEditing] = useState(false);
	const [values, setValues] = useState<Record<Field, string>>({
		name: "",
		email: "",
		phone: "",
	});
	const [fieldError, setFieldError] = useState<{
		field: Field;
		text: string;
	}>();
	const [editMessage, setEditMessage] = useState<string>();
	const [signedOut, setSignedOut] = useState(false);
	const [saving, setSaving] = useState(false);
	const inputs = {
		name: useRef<HTMLInputElement>(null),
		email: useRef<HTMLInputElement>(null),
		phone: useRef<HTMLInputElement>(null),
	};
	const editButton = useRef<HTMLButtonElement>(null);

	// Consent
	const [consents, setConsents] = useState<ConsentState | "loading" | "error">(
		"loading",
	);
	const [methods, setMethods] = useState<Record<string, string>>({});
	const [consentBusy, setConsentBusy] = useState<string | null>(null);
	const [consentMessage, setConsentMessage] = useState<string>();
	const [consentSignedOut, setConsentSignedOut] = useState(false);
	// One id per purpose, status and method until it saves, so a retry of the
	// same choice is a replay. Any success for a purpose clears its ids.
	const pendingConsent = useRef<Record<string, string>>({});
	const clearPending = (purpose: string) => {
		for (const key of Object.keys(pendingConsent.current))
			if (key.startsWith(`${purpose}:`)) delete pendingConsent.current[key];
	};

	const loadConsents = useCallback(async () => {
		const result = await getConsents(organizationId, clientId);
		if (result === "signed_out") {
			router.replace("/");
			return undefined;
		}
		setConsents(typeof result === "object" ? result : "error");
		return typeof result === "object" ? result : undefined;
	}, [organizationId, clientId, router]);

	useEffect(() => {
		let active = true;
		getClient(organizationId, clientId).then((result) => {
			if (!active) return;
			if (result === "signed_out") return router.replace("/");
			setView(result);
			if (typeof result === "object") loadConsents();
		});
		return () => {
			active = false;
		};
	}, [organizationId, clientId, router, loadConsents]);

	const startEdit = (client: Client) => {
		setValues({
			name: client.name,
			email: client.email ?? "",
			phone: client.phone ?? "",
		});
		setFieldError(undefined);
		setEditMessage(undefined);
		setSignedOut(false);
		setEditing(true);
	};

	useEffect(() => {
		if (editing) inputs.name.current?.focus();
	}, [editing, inputs.name]);

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (saving || typeof view !== "object") return;
		setFieldError(undefined);
		setEditMessage(undefined);
		setSignedOut(false);
		setAnnouncement("");
		setSaving(true);
		const result = await updateClient(organizationId, clientId, {
			version: view.version,
			...values,
		});
		setSaving(false);
		if (result === "signed_out") return setSignedOut(true);
		if (result === "not_found") return setView("not_found");
		if (result === "error") return setEditMessage(SAVE_ERROR);
		if ("conflict" in result) {
			setView(result.conflict);
			setValues({
				name: result.conflict.name,
				email: result.conflict.email ?? "",
				phone: result.conflict.phone ?? "",
			});
			return setEditMessage(EDIT_CONFLICT);
		}
		if ("invalid" in result) {
			const field = result.invalid as Field;
			if (field in FIELD_ERRORS) {
				setFieldError({ field, text: FIELD_ERRORS[field] });
				inputs[field].current?.focus();
			} else setEditMessage(SAVE_ERROR);
			return;
		}
		setView(result.client);
		setEditing(false);
		setAnnouncement("Client details saved.");
		requestAnimationFrame(() => editButton.current?.focus());
	};

	const record = async (purpose: string, status: "granted" | "withdrawn") => {
		if (consentBusy) return;
		setConsentMessage(undefined);
		setConsentSignedOut(false);
		setAnnouncement("");
		const method = methods[purpose] ?? "written";
		const key = `${purpose}:${status}:${method}`;
		pendingConsent.current[key] ??= crypto.randomUUID();
		const id = pendingConsent.current[key];
		setConsentBusy(purpose);
		const result = await recordConsent(organizationId, clientId, {
			id,
			purpose,
			status,
			method,
		});
		if (result === "signed_out") {
			setConsentBusy(null);
			return setConsentSignedOut(true);
		}
		if (result === "not_found") {
			setConsentBusy(null);
			return setView("not_found");
		}
		// After an error the record may still have been saved with its reply
		// lost, so the history decides.
		const latest = await loadConsents();
		setConsentBusy(null);
		if (
			result === "saved" ||
			latest?.history.some((entry) => entry.id === id)
		) {
			clearPending(purpose);
			return setAnnouncement(
				status === "granted" ? "Consent recorded." : "Withdrawal recorded.",
			);
		}
		if (result === "conflict") delete pendingConsent.current[key];
		setConsentMessage(result === "conflict" ? CONSENT_CONFLICT : CONSENT_ERROR);
	};

	const field = (name: Field, text: string, type: "text" | "email" | "tel") => {
		const error = fieldError?.field === name ? fieldError.text : undefined;
		return (
			<>
				<label htmlFor={`edit-${name}`}>{text}</label>
				<input
					id={`edit-${name}`}
					ref={inputs[name]}
					type={type}
					value={values[name]}
					onChange={(event) =>
						setValues((current) => ({ ...current, [name]: event.target.value }))
					}
					maxLength={name === "email" ? 254 : name === "phone" ? 30 : 200}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `edit-${name}-error` : undefined}
				/>
				{error && (
					<p id={`edit-${name}-error`} className="error">
						{error}
					</p>
				)}
			</>
		);
	};

	const back = `/o/${encodeURIComponent(organizationId)}/clients`;
	return (
		<>
			<AppHeader organizationId={organizationId} current="clients" />
			<main id="main" tabIndex={-1}>
				<Link href={back}>Back to clients</Link>
				{view === "loading" && <p role="status">Loading client…</p>}
				{view === "error" && (
					<>
						<h1>Client</h1>
						<p role="alert" className="notice">
							This client could not be loaded. Please refresh the page.
						</p>
					</>
				)}
				{view === "not_found" && (
					<>
						<h1>Client not found</h1>
						<p role="alert" className="notice">
							This client is not available to you.
						</p>
					</>
				)}
				{typeof view === "object" && (
					<>
						<h1>{view.name}</h1>
						{editMessage && (
							<p role="alert" className="notice">
								{editMessage}
							</p>
						)}
						{editing ? (
							<form className="add" onSubmit={save} noValidate>
								<h2>Edit details</h2>
								{field("name", "Name", "text")}
								{field("email", "Email (optional)", "email")}
								{field("phone", "Phone (optional)", "tel")}
								{signedOut && (
									<p role="alert" className="error">
										{SIGNED_OUT} <Link href="/">Sign in</Link>
									</p>
								)}
								<div className="actions-row">
									<button type="submit" className="button" disabled={saving}>
										Save changes
									</button>
									<button
										type="button"
										className="link"
										onClick={() => {
											setEditing(false);
											requestAnimationFrame(() => editButton.current?.focus());
										}}
									>
										Cancel
									</button>
								</div>
							</form>
						) : (
							<>
								<dl className="details">
									<dt>Email</dt>
									<dd>
										{view.email ? (
											<a href={`mailto:${view.email}`}>{view.email}</a>
										) : (
											"Not given"
										)}
									</dd>
									<dt>Phone</dt>
									<dd>
										{view.phone ? (
											<a href={`tel:${view.phone}`}>
												{formatPhone(view.phone)}
											</a>
										) : (
											"Not given"
										)}
									</dd>
									<dt>Added</dt>
									<dd>{formatInZone(view.createdAt, TORONTO)}</dd>
								</dl>
								<button
									type="button"
									className="button secondary"
									ref={editButton}
									onClick={() => startEdit(view)}
								>
									Edit details
								</button>
							</>
						)}

						<h2>Consent</h2>
						{CONSENT_WORDING_IS_PLACEHOLDER && (
							<p className="notice page-notice">
								The consent wording is a placeholder until your brokerage's
								privacy lead approves it.
							</p>
						)}
						{consentMessage && (
							<p role="alert" className="error">
								{consentMessage}
							</p>
						)}
						{consentSignedOut && (
							<p role="alert" className="error">
								Your session has ended. <Link href="/">Sign in</Link> again,
								then record it.
							</p>
						)}
						{consents === "loading" && <p role="status">Loading consent…</p>}
						{consents === "error" && (
							<div className="notice">
								<p>Consent could not be loaded.</p>
								<button
									type="button"
									className="button"
									onClick={() => loadConsents()}
								>
									Try again
								</button>
							</div>
						)}
						{typeof consents === "object" && (
							<>
								<ul className="tasks consents" aria-label="Consent">
									{consents.current.map((entry) => (
										<li key={entry.purpose}>
											<span className="title">{label(entry.purpose)}</span>
											<span className="meta">
												{entry.status && entry.recordedAt
													? `${STATUS_LABELS[entry.status] ?? entry.status} (${(
															METHOD_LABELS[entry.method ?? ""] ??
																entry.method ??
																""
														).toLowerCase()}) · ${formatInZone(entry.recordedAt, TORONTO)}`
													: "Not recorded"}
											</span>
											<div className="actions-row">
												<label htmlFor={`method-${entry.purpose}`}>
													How
													<span className="visually-hidden">
														: {label(entry.purpose)}
													</span>
												</label>
												<select
													id={`method-${entry.purpose}`}
													className="status"
													value={methods[entry.purpose] ?? "written"}
													onChange={(event) =>
														setMethods((current) => ({
															...current,
															[entry.purpose]: event.target.value,
														}))
													}
												>
													{CONSENT_METHODS.map((method) => (
														<option key={method} value={method}>
															{METHOD_LABELS[method]}
														</option>
													))}
												</select>
												<button
													type="button"
													className="link"
													disabled={consentBusy !== null}
													aria-label={`Record consent: ${label(entry.purpose)}`}
													onClick={() => record(entry.purpose, "granted")}
												>
													Record consent
												</button>
												<button
													type="button"
													className="link"
													disabled={consentBusy !== null}
													aria-label={`Record withdrawal: ${label(entry.purpose)}`}
													onClick={() => record(entry.purpose, "withdrawn")}
												>
													Record withdrawal
												</button>
											</div>
										</li>
									))}
								</ul>
								<h3>Consent history</h3>
								{consents.history.length === 0 ? (
									<p>Nothing recorded yet.</p>
								) : (
									<ol className="history" aria-label="Consent history">
										{consents.history.map((entry) => (
											<li key={entry.id}>
												{STATUS_LABELS[entry.status] ?? entry.status} ·{" "}
												{label(entry.purpose)} ·{" "}
												{(
													METHOD_LABELS[entry.method] ?? entry.method
												).toLowerCase()}{" "}
												· {formatInZone(entry.recordedAt, TORONTO)}
											</li>
										))}
									</ol>
								)}
							</>
						)}
					</>
				)}
				<p role="status" aria-live="polite" className="visually-hidden">
					{announcement}
				</p>
			</main>
		</>
	);
}
