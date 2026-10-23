"use client";

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
	createClient,
	formatPhone,
	listClients,
	type NewClientBody,
	rememberOrganization,
} from "../../../lib/api";
import { AppHeader } from "../app-header";

const FIELD_ERRORS: Record<string, string> = {
	name: "Enter a name of 1 to 200 characters without line breaks.",
	email: "Enter a valid email address, like name@example.com.",
	phone: "Enter a phone number with 7 to 15 digits.",
};
const SAVE_ERROR = "That client could not be saved. Please try again.";
const ALREADY_SAVED =
	"Your earlier client was already saved. Press Add client again to add this one as well.";
const SESSION_ENDED =
	"Your session has ended. Sign in again, then add this client.";

type Load = "loading" | "ready" | "error" | "not_found";
type Field = "name" | "email" | "phone";

const byName = (a: Client, b: Client) =>
	a.name.localeCompare(b.name, "en-CA") || a.id.localeCompare(b.id);

export default function Clients() {
	const router = useRouter();
	const { organizationId } = useParams<{ organizationId: string }>();
	const [load, setLoad] = useState<Load>("loading");
	const [clients, setClients] = useState<Client[]>([]);
	const [values, setValues] = useState<Record<Field, string>>({
		name: "",
		email: "",
		phone: "",
	});
	const [fieldError, setFieldError] = useState<{
		field: Field;
		text: string;
	}>();
	const [formError, setFormError] = useState<string>();
	const [sessionEnded, setSessionEnded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	// One id per submission: retries reuse it, so the API replays instead of
	// adding a second client. A new id is made only after a success.
	const pendingId = useRef<string | null>(null);
	const inputs = {
		name: useRef<HTMLInputElement>(null),
		email: useRef<HTMLInputElement>(null),
		phone: useRef<HTMLInputElement>(null),
	};

	const refresh = useCallback(async () => {
		setLoad("loading");
		const result = await listClients(organizationId);
		if (result === "signed_out") return router.replace("/");
		if (result === "not_found" || result === "error") return setLoad(result);
		rememberOrganization(organizationId);
		setClients(result);
		setLoad("ready");
	}, [organizationId, router]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		setFieldError(undefined);
		setFormError(undefined);
		setSessionEnded(false);
		setAnnouncement("");
		pendingId.current ??= crypto.randomUUID();
		const body: NewClientBody = { id: pendingId.current, name: values.name };
		if (values.email.trim()) body.email = values.email;
		if (values.phone.trim()) body.phone = values.phone;
		setSaving(true);
		const result = await createClient(organizationId, body);
		setSaving(false);
		if (result === "signed_out") return setSessionEnded(true);
		if (result === "not_found") return setLoad("not_found");
		if (result === "error") return setFormError(SAVE_ERROR);
		if (result === "conflict") {
			// The same id with different details: an earlier try may have been
			// saved with its reply lost. Show the saved list, and use a new id.
			const sent = pendingId.current;
			pendingId.current = null;
			const latest = await listClients(organizationId);
			if (Array.isArray(latest)) {
				setClients(latest);
				if (latest.some((client) => client.id === sent))
					return setFormError(ALREADY_SAVED);
			}
			return setFormError(SAVE_ERROR);
		}
		if ("invalid" in result) {
			const field = result.invalid as Field;
			if (field in FIELD_ERRORS) {
				setFieldError({ field, text: FIELD_ERRORS[field] as string });
				inputs[field].current?.focus();
			} else {
				pendingId.current = null;
				setFormError(SAVE_ERROR);
			}
			return;
		}
		pendingId.current = null;
		const added = result.client;
		setClients((current) =>
			[...current.filter((client) => client.id !== added.id), added].sort(
				byName,
			),
		);
		setValues({ name: "", email: "", phone: "" });
		setAnnouncement("Client added.");
	};

	const field = (
		name: Field,
		label: string,
		type: "text" | "email" | "tel",
		autoComplete: string,
	) => {
		const error = fieldError?.field === name ? fieldError.text : undefined;
		return (
			<>
				<label htmlFor={`client-${name}`}>{label}</label>
				<input
					id={`client-${name}`}
					ref={inputs[name]}
					type={type}
					autoComplete={autoComplete}
					value={values[name]}
					onChange={(event) =>
						setValues((current) => ({ ...current, [name]: event.target.value }))
					}
					maxLength={name === "email" ? 254 : name === "phone" ? 30 : 200}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `client-${name}-error` : undefined}
				/>
				{error && (
					<p id={`client-${name}-error`} className="error">
						{error}
					</p>
				)}
			</>
		);
	};

	const base = `/o/${encodeURIComponent(organizationId)}`;
	return (
		<>
			<AppHeader organizationId={organizationId} current="clients" />
			<main id="main" tabIndex={-1}>
				<h1>Clients</h1>
				{load === "loading" && <p role="status">Loading clients…</p>}
				{load === "error" && (
					<div role="alert" className="notice">
						<p>Clients could not be loaded.</p>
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
						{clients.length === 0 ? (
							<p>No clients yet. Add your first client below.</p>
						) : (
							<ul className="tasks clients" aria-label="Clients">
								{clients.map((client) => (
									<li key={client.id}>
										<Link
											className="title"
											href={`${base}/clients/${encodeURIComponent(client.id)}`}
										>
											{client.name}
										</Link>
										<span className="meta">
											{[client.email, client.phone && formatPhone(client.phone)]
												.filter(Boolean)
												.join(" · ") || "No contact details"}
										</span>
									</li>
								))}
							</ul>
						)}
						<form className="add" onSubmit={submit} noValidate>
							<h2>Add a client</h2>
							{field("name", "Name", "text", "off")}
							{field("email", "Email (optional)", "email", "off")}
							{field("phone", "Phone (optional)", "tel", "off")}
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
								Add client
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
