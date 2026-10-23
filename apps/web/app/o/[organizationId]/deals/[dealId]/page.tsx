"use client";

import {
	canMoveDeal,
	DEAL_STAGES,
	type DealStage,
	formatAddress,
	formatInZone,
	TORONTO,
} from "@reo/domain";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { changeStage, type Deal, getDeal } from "../../../../lib/api";
import { AppHeader } from "../../app-header";
import { sideLabel, stageLabel } from "../labels";

type View = Deal | "loading" | "not_found" | "error";

const CHANGED =
	"This deal was changed in another window. The latest stage is shown; choose again if you still need to move it.";

/** Stages this deal may move to now, in their usual order. */
const nextStages = (stage: string) =>
	DEAL_STAGES.filter((to) => canMoveDeal(stage as DealStage, to));

export default function DealDetail() {
	const router = useRouter();
	const { organizationId, dealId } = useParams<{
		organizationId: string;
		dealId: string;
	}>();
	const [view, setView] = useState<View>("loading");
	const [target, setTarget] = useState("");
	const [message, setMessage] = useState<string>();
	const [signedOut, setSignedOut] = useState(false);
	const [saving, setSaving] = useState(false);
	const [announcement, setAnnouncement] = useState("");

	const show = useCallback((deal: Deal) => {
		setView(deal);
		setTarget(nextStages(deal.stage)[0] ?? "");
	}, []);

	useEffect(() => {
		let active = true;
		getDeal(organizationId, dealId).then((result) => {
			if (!active) return;
			if (result === "signed_out") return router.replace("/");
			if (typeof result === "object") show(result);
			else setView(result);
		});
		return () => {
			active = false;
		};
	}, [organizationId, dealId, router, show]);

	const move = async (event: FormEvent) => {
		event.preventDefault();
		if (saving || typeof view !== "object" || !target) return;
		setMessage(undefined);
		setSignedOut(false);
		setAnnouncement("");
		setSaving(true);
		const result = await changeStage(
			organizationId,
			dealId,
			target,
			view.version,
		);
		setSaving(false);
		if (result === "signed_out") return setSignedOut(true);
		if (result === "not_found") return setView("not_found");
		if (result === "error")
			return setMessage("The stage could not be changed. Please try again.");
		if ("conflict" in result) {
			show(result.conflict);
			return setMessage(CHANGED);
		}
		show(result.deal);
		setAnnouncement(`Deal moved to ${stageLabel(result.deal.stage)}.`);
	};

	const base = `/o/${encodeURIComponent(organizationId)}`;
	const options = typeof view === "object" ? nextStages(view.stage) : [];
	return (
		<>
			<AppHeader organizationId={organizationId} current="deals" />
			<main id="main" tabIndex={-1}>
				<Link href={`${base}/deals`}>Back to deals</Link>
				{view === "loading" && <p role="status">Loading deal…</p>}
				{view === "error" && (
					<>
						<h1>Deal</h1>
						<p role="alert" className="notice">
							This deal could not be loaded. Please refresh the page.
						</p>
					</>
				)}
				{view === "not_found" && (
					<>
						<h1>Deal not found</h1>
						<p role="alert" className="notice">
							This deal is not available to you.
						</p>
					</>
				)}
				{typeof view === "object" && (
					<>
						<h1>{formatAddress(view.address)}</h1>
						{message && (
							<p role="alert" className="notice">
								{message}
							</p>
						)}
						<dl className="details">
							<dt>We represent the</dt>
							<dd>{sideLabel(view.side)}</dd>
							<dt>Stage</dt>
							<dd>
								{stageLabel(view.stage)}, since{" "}
								{formatInZone(view.stageChangedAt, TORONTO)}
							</dd>
							<dt>Clients</dt>
							<dd>
								<ul className="plain">
									{view.clients.map((c) => (
										<li key={c.id}>
											{c.name ? (
												<Link
													href={`${base}/clients/${encodeURIComponent(c.id)}`}
												>
													{c.name}
												</Link>
											) : (
												"Client not available"
											)}
										</li>
									))}
								</ul>
							</dd>
							<dt>Added</dt>
							<dd>{formatInZone(view.createdAt, TORONTO)}</dd>
						</dl>
						<h2>Stage</h2>
						<p className="notice page-notice">
							Stage names are placeholders until your broker of record approves
							them.
						</p>
						{options.length === 0 ? (
							<p>A closed deal cannot be moved.</p>
						) : (
							<form className="actions-row" onSubmit={move}>
								<label htmlFor="deal-stage">Move to</label>
								<select
									id="deal-stage"
									className="status"
									value={target}
									onChange={(event) => setTarget(event.target.value)}
								>
									{options.map((stage) => (
										<option key={stage} value={stage}>
											{stageLabel(stage)}
										</option>
									))}
								</select>
								<button type="submit" className="button" disabled={saving}>
									Move deal
								</button>
							</form>
						)}
						{signedOut && (
							<p role="alert" className="error">
								Your session has ended. <Link href="/">Sign in</Link> again,
								then move the deal.
							</p>
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
