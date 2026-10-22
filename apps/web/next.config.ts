import type { NextConfig } from "next";

const securityHeaders = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "Referrer-Policy", value: "no-referrer" },
	// Framing only; a full script CSP needs nonces (ADR 0016, not done yet).
	{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

// The API sits behind the website on the same machine (ADR 0016), so the
// browser only ever talks to one origin and the __Host- cookies, the Origin
// check and the sign-in redirect all work unchanged.
function apiOrigin(): string {
	const value = process.env.REO_API_ORIGIN ?? "http://127.0.0.1:4000";
	const url = new URL(value);
	const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
	if (url.protocol !== "http:" || !loopback || url.origin !== value)
		throw new Error(
			"REO_API_ORIGIN must be a loopback http origin, e.g. http://127.0.0.1:4000",
		);
	return url.origin;
}

const api = apiOrigin();

const nextConfig: NextConfig = {
	poweredByHeader: false,
	async headers() {
		return [{ source: "/:path*", headers: securityHeaders }];
	},
	async rewrites() {
		return [
			{ source: "/auth/:path*", destination: `${api}/auth/:path*` },
			{ source: "/v1/:path*", destination: `${api}/v1/:path*` },
		];
	},
};

export default nextConfig;
