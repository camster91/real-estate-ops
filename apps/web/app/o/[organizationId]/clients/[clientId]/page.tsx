"use client";

import { formatInZone, TORONTO } from "@reo/domain";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Client, formatPhone, getClient } from "../../../../lib/api";
import { AppHeader } from "../../app-header";

type View = Client | "loading" | "not_found" | "error";

export default function ClientDetail() {
	const router = useRouter();
	const { organizationId, clientId } = useParams<{
		organizationId: string;
		clientId: string;
	}>();
	const [view, setView] = useState<View>("loading");

	useEffect(() => {
		let active = true;
		getClient(organizationId, clientId).then((result) => {
			if (!active) return;
			if (result === "signed_out") return router.replace("/");
			setView(result);
		});
		return () => {
			active = false;
		};
	}, [organizationId, clientId, router]);

	const back = `/o/${encodeURIComponent(organizationId)}/clients`;
	return (
		<>
			<AppHeader organizationId={organizationId} current="clients" />
			<main id="main" tabIndex={-1}>
				<Link href={back}>Back to clients</Link>
				{view === "loading" && <p role="status">Loading client…</p>}
				{view === "error" && (
					<p role="alert" className="notice">
						This client could not be loaded. Please refresh the page.
					</p>
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
									<a href={`tel:${view.phone}`}>{formatPhone(view.phone)}</a>
								) : (
									"Not given"
								)}
							</dd>
							<dt>Added</dt>
							<dd>{formatInZone(view.createdAt, TORONTO)}</dd>
						</dl>
					</>
				)}
			</main>
		</>
	);
}
