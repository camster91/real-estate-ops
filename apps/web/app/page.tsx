export default function Home() {
	return (
		<main id="main" tabIndex={-1}>
			<p className="eyebrow">Real Estate Ops</p>
			<h1>A shared workspace for your real estate team.</h1>
			<p>
				This workspace is being prepared. Access to client records and
				operational tools is not available yet.
			</p>
			<aside aria-label="Workspace status">
				<strong>Access pending</strong>
				<p>
					Client records will remain unavailable until secure access is enabled.
				</p>
			</aside>
		</main>
	);
}
