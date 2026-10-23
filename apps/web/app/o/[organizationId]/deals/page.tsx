"use client";

import {
	DEAL_CLIENTS_MAX,
	DEAL_SIDE_LABELS,
	DEAL_SIDES,
	formatAddress,
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
	createDeal,
	type Deal,
	listClients,
	listDeals,
	type NewDealBody,
	rememberOrganization,
} from "../../../lib/api";
import { AppHeader } from "../app-header";
import { sideLabel, stageLabel } from "./labels";

type Load = "loading" | "ready" | "error" | "not_found";
type Field = "street" | "unit" | "city" | "postalCode";

const FIELD_ERRORS: Record<Field | "clientIds" | "side", string> = {
	side: "Choose whom the brokerage represents.",
	street: "Enter a street address of 1 to 200 characters.",
	unit: "Enter a unit of up to 20 characters, or leave it empty.",
	city: "Enter a city of 1 to 100 characters.",
	postalCode: "Enter an Ontario postal code, like K1A 0B1.",
	clientIds: `Choose 1 to ${DEAL_CLIENTS_MAX} of your clients.`,
};
const SAVE_ERROR = "That deal could not be saved. Please try again.";
const ALREADY_SAVED =
	"Your earlier deal was already saved. Press Add deal again to add this one as well.";
const SESSION_ENDED =
	"Your session has ended. Sign in again, then add this deal.";
const EMPTY = { street: "", unit: "", city: "", postalCode: "" };

export default function Deals() {
	const router = useRouter();
	const { organizationId } = useParams<{ organizationId: string }>();
	const [load, setLoad] = useState<Load>("loading");
	const [deals, setDeals] = useState<Deal[]>([]);
	const [more, setMore] = useState(false);
	const [clients, setClients] = useState<Client[]>([]);
	const [side, setSide] = useState<string>("buyer");
	const [values, setValues] = useState<Record<Field, string>>(EMPTY);
	const [chosen, setChosen] = useState<string[]>([]);
	const [fieldError, setFieldError] = useState<{
		field: Field | "clientIds" | "side";
		text: string;
	}>();
	const [formError, setFormError] = useState<string>();
	const [sessionEnded, setSessionEnded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	// One id per submission: retries reuse it, so the API replays instead of
	// adding a second deal. A new id is made only after a success.
	const pendingId = useRef<string | null>(null);
	const inputs = {
		side: useRef<HTMLSelectElement>(null),
		street: useRef<HTMLInputElement>(null),
		unit: useRef<HTMLInputElement>(null),
		city: useRef<HTMLInputElement>(null),
		postalCode: useRef<HTMLInputElement>(null),
		clientIds: useRef<HTMLFieldSetElement>(null),
	};

	const refresh = useCallback(async () => {
		setLoad("loading");
		const [result, mine] = await Promise.all([
			listDeals(organizationId),
			listClients(organizationId),
		]);
		if (result === "signed_out" || mine === "signed_out")
			return router.replace("/");
		if (result === "not_found" || mine === "not_found")
			return setLoad("not_found");
		if (result === "error" || mine === "error") return setLoad("error");
		rememberOrganization(organizationId);
		setDeals(result.deals);
		setMore(result.more);
		setClients(mine.clients);
		setLoad("ready");
	}, [organizationId, router]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const showFieldError = (field: keyof typeof FIELD_ERRORS) => {
		setFieldError({ field, text: FIELD_ERRORS[field] });
		const target = inputs[field].current;
		if (field === "clientIds")
			target?.querySelector<HTMLInputElement>("input")?.focus();
		else (target as HTMLElement | null)?.focus();
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		setFieldError(undefined);
		setFormError(undefined);
		setSessionEnded(false);
		setAnnouncement("");
		if (chosen.length < 1 || chosen.length > DEAL_CLIENTS_MAX)
			return showFieldError("clientIds");
		pendingId.current ??= crypto.randomUUID();
		const body: NewDealBody = {
			id: pendingId.current,
			side,
			address: {
				street: values.street,
				city: values.city,
				postalCode: values.postalCode,
			},
			clientIds: chosen,
		};
		if (values.unit.trim()) body.address.unit = values.unit;
		setSaving(true);
		const result = await createDeal(organizationId, body);
		setSaving(false);
		if (result === "signed_out") return setSessionEnded(true);
		if (result === "not_found") return setLoad("not_found");
		if (result === "error") return setFormError(SAVE_ERROR);
		if (result === "conflict") {
			// The same id with different details: an earlier try may have been
			// saved with its reply lost. Show the saved list, and use a new id.
			const sent = pendingId.current;
			pendingId.current = null;
			const latest = await listDeals(organizationId);
			if (typeof latest === "object") {
				setDeals(latest.deals);
				setMore(latest.more);
				if (latest.deals.some((deal) => deal.id === sent))
					return setFormError(ALREADY_SAVED);
			}
			return setFormError(SAVE_ERROR);
		}
		if ("invalid" in result) {
			if (result.invalid in FIELD_ERRORS)
				showFieldError(result.invalid as keyof typeof FIELD_ERRORS);
			else {
				pendingId.current = null;
				setFormError(SAVE_ERROR);
			}
			return;
		}
		pendingId.current = null;
		const added = result.deal;
		setDeals((current) => [
			added,
			...current.filter((deal) => deal.id !== added.id),
		]);
		setValues(EMPTY);
		setChosen([]);
		setAnnouncement("Deal added.");
	};

	const field = (name: Field, label: string, autoComplete: string) => {
		const error = fieldError?.field === name ? fieldError.text : undefined;
		return (
			<>
				<label htmlFor={`deal-${name}`}>{label}</label>
				<input
					id={`deal-${name}`}
					ref={inputs[name]}
					type="text"
					autoComplete={autoComplete}
					value={values[name]}
					onChange={(event) =>
						setValues((current) => ({ ...current, [name]: event.target.value }))
					}
					maxLength={{ street: 200, unit: 20, city: 100, postalCode: 7 }[name]}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `deal-${name}-error` : undefined}
				/>
				{error && (
					<p id={`deal-${name}-error`} className="error">
						{error}
					</p>
				)}
			</>
		);
	};

	const base = `/o/${encodeURIComponent(organizationId)}`;
	const clientsError =
		fieldError?.field === "clientIds" ? fieldError.text : undefined;
	return (
		<>
			<AppHeader organizationId={organizationId} current="deals" />
			<main id="main" tabIndex={-1}>
				<h1>Deals</h1>
				{load === "loading" && <p role="status">Loading deals…</p>}
				{load === "error" && (
					<div role="alert" className="notice">
						<p>Deals could not be loaded.</p>
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
						<p className="notice page-notice">
							Stage names are placeholders until your broker of record approves
							them.
						</p>
						{deals.length === 0 ? (
							<p>No deals yet. Add your first deal below.</p>
						) : (
							<ul className="tasks deals" aria-label="Deals">
								{deals.map((deal) => (
									<li key={deal.id}>
										<Link
											className="title"
											href={`${base}/deals/${encodeURIComponent(deal.id)}`}
										>
											{formatAddress(deal.address)}
										</Link>
										<span className="meta">
											{[
												sideLabel(deal.side),
												stageLabel(deal.stage),
												deal.clients
													.map((c) => c.name ?? "Client not available")
													.join(", "),
											].join(" · ")}
										</span>
									</li>
								))}
							</ul>
						)}
						{more && (
							<p className="notice page-notice">
								Showing your newest 100 deals. Search is coming soon.
							</p>
						)}
						<form className="add" onSubmit={submit} noValidate>
							<h2>Add a deal</h2>
							<label htmlFor="deal-side">We represent the</label>
							<select
								id="deal-side"
								ref={inputs.side}
								className="status"
								value={side}
								onChange={(event) => setSide(event.target.value)}
							>
								{DEAL_SIDES.map((value) => (
									<option key={value} value={value}>
										{DEAL_SIDE_LABELS[value]}
									</option>
								))}
							</select>
							{field("street", "Street address", "off")}
							{field("unit", "Unit (optional)", "off")}
							{field("city", "City", "off")}
							{field("postalCode", "Postal code", "off")}
							<fieldset
								ref={inputs.clientIds}
								className="choices"
								aria-describedby={
									clientsError ? "deal-clients-error" : undefined
								}
							>
								<legend>Clients on this deal</legend>
								{clients.length === 0 ? (
									<p>
										You have no clients yet.{" "}
										<Link href={`${base}/clients`}>Add a client first</Link>.
									</p>
								) : (
									clients.map((c) => (
										<label key={c.id} className="choice">
											<input
												type="checkbox"
												checked={chosen.includes(c.id)}
												aria-invalid={clientsError ? true : undefined}
												onChange={(event) =>
													setChosen((current) =>
														event.target.checked
															? [...current, c.id]
															: current.filter((id) => id !== c.id),
													)
												}
											/>
											{c.name}
										</label>
									))
								)}
								{clientsError && (
									<p id="deal-clients-error" className="error">
										{clientsError}
									</p>
								)}
							</fieldset>
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
								Add deal
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
