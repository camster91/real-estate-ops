"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
	getSession,
	type Membership,
	rememberedOrganization,
	rememberOrganization,
} from "./lib/api";

const SIGN_IN_MESSAGES: Record<string, string> = {
	failed: "Sign-in did not complete. Please try again.",
	no_access:
		"Your account does not have access yet. Ask your broker of record to add you.",
	unavailable: "Sign-in is temporarily unavailable. Please try again shortly.",
};

type View =
	| { kind: "loading" }
	| { kind: "signed_out"; message: string | undefined }
	| { kind: "picker"; memberships: Membership[] }
	| { kind: "error" };

const tasksHref = (organizationId: string) =>
	`/o/${encodeURIComponent(organizationId)}/tasks`;

export default function Home() {
	const router = useRouter();
	const [view, setView] = useState<View>({ kind: "loading" });

	useEffect(() => {
		let active = true;
		const query = new URLSearchParams(window.location.search);
		const reason = query.get("signin");
		const choose = query.get("choose") === "1";
		getSession().then((session) => {
			if (!active) return;
			if (session === "error") return setView({ kind: "error" });
			if (session === "signed_out" || session.memberships.length === 0)
				return setView({
					kind: "signed_out",
					message: reason ? SIGN_IN_MESSAGES[reason] : undefined,
				});
			const { memberships } = session;
			const remembered = rememberedOrganization();
			const target =
				memberships.length === 1
					? memberships[0]
					: memberships.find((m) => m.organizationId === remembered);
			if (target && !choose) router.replace(tasksHref(target.organizationId));
			else setView({ kind: "picker", memberships });
		});
		return () => {
			active = false;
		};
	}, [router]);

	const choose = (organizationId: string) => {
		rememberOrganization(organizationId);
		router.push(tasksHref(organizationId));
	};

	return (
		<main id="main" tabIndex={-1}>
			<p className="eyebrow">Real Estate Ops</p>
			{view.kind === "loading" && <p role="status">Loading…</p>}
			{view.kind === "error" && (
				<p role="alert">Something went wrong. Please refresh the page.</p>
			)}
			{view.kind === "signed_out" && (
				<>
					<h1>Sign in to Real Estate Ops</h1>
					{view.message && (
						<p role="alert" className="notice">
							{view.message}
						</p>
					)}
					<ul className="actions">
						<li>
							<a className="button" href="/auth/google/login">
								Sign in with Google
							</a>
						</li>
						<li>
							<a className="button" href="/auth/microsoft/login">
								Sign in with Microsoft
							</a>
						</li>
					</ul>
				</>
			)}
			{view.kind === "picker" && (
				<>
					<h1>Choose a brokerage</h1>
					<ul className="choices">
						{view.memberships.map((membership) => (
							<li key={membership.organizationId}>
								<button
									type="button"
									className="button"
									onClick={() => choose(membership.organizationId)}
								>
									{membership.name}
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</main>
	);
}
