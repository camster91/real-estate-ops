"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "../../lib/api";

/** The header on every brokerage page: sections, switch brokerage, sign out. */
export function AppHeader(props: {
	organizationId: string;
	current: "tasks" | "clients" | "deals";
}) {
	const router = useRouter();
	const [signOutFailed, setSignOutFailed] = useState(false);
	const base = `/o/${encodeURIComponent(props.organizationId)}`;
	const leave = async () => {
		setSignOutFailed(false);
		// On a shared computer, never pretend the session ended when it did not.
		if (await signOut()) router.replace("/");
		else setSignOutFailed(true);
	};
	const section = (href: string, label: string, key: typeof props.current) => (
		<Link href={href} aria-current={props.current === key ? "page" : undefined}>
			{label}
		</Link>
	);
	return (
		<header className="bar">
			<span className="eyebrow">Real Estate Ops</span>
			<nav aria-label="Sections" className="sections">
				{section(`${base}/tasks`, "My tasks", "tasks")}
				{section(`${base}/clients`, "Clients", "clients")}
				{section(`${base}/deals`, "Deals", "deals")}
			</nav>
			<nav aria-label="Account">
				<Link href="/?choose=1">Switch brokerage</Link>
				<button type="button" className="link" onClick={leave}>
					Sign out
				</button>
			</nav>
			{signOutFailed && (
				<p role="alert" className="notice header-notice">
					Sign-out did not complete. Please try again.
				</p>
			)}
		</header>
	);
}
