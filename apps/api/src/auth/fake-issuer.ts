// Test-only OpenID Connect issuer on 127.0.0.1. It serves discovery, JWKS, an
// authorization endpoint that redirects straight back with a code, and a token
// endpoint that checks client credentials and PKCE. Never used at runtime.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";

export interface IdClaims extends JWTPayload {
	nonce: string;
	hd: string;
	email: string;
	name: string;
}

export interface FakeIssuer {
	issuer: string;
	clientId: string;
	clientSecret: string;
	/** Sets claims (and optionally a wrong signing key) for the next ID token. */
	mint(claims: Partial<IdClaims>, options?: { key?: "other" }): void;
	close(): Promise<void>;
}

interface PendingCode {
	nonce: string | null;
	challenge: string | null;
	redirectUri: string;
}

const KID = "synthetic-key";

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function clientCredentials(request: IncomingMessage, body: URLSearchParams) {
	const header = request.headers.authorization;
	if (header?.startsWith("Basic ")) {
		const [id, secret] = Buffer.from(header.slice(6), "base64")
			.toString("utf8")
			.split(":")
			.map(decodeURIComponent);
		return { id, secret };
	}
	return {
		id: body.get("client_id") ?? undefined,
		secret: body.get("client_secret") ?? undefined,
	};
}

export async function startFakeIssuer(): Promise<FakeIssuer> {
	const main = await generateKeyPair("RS256");
	const other = await generateKeyPair("RS256");
	const jwk = { ...(await exportJWK(main.publicKey)), kid: KID, alg: "RS256" };
	const clientId = "synthetic-client";
	const clientSecret = randomBytes(24).toString("hex");
	const codes = new Map<string, PendingCode>();
	let next: { claims: Partial<IdClaims>; key?: "other" } = { claims: {} };
	let issuer = "";

	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", issuer);
		const json = (status: number, body: unknown) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (url.pathname === "/.well-known/openid-configuration")
			return json(200, {
				issuer,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				jwks_uri: `${issuer}/jwks`,
				response_types_supported: ["code"],
				subject_types_supported: ["public"],
				id_token_signing_alg_values_supported: ["RS256"],
				code_challenge_methods_supported: ["S256"],
				token_endpoint_auth_methods_supported: [
					"client_secret_post",
					"client_secret_basic",
				],
			});
		if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
		if (url.pathname === "/authorize") {
			const redirectUri = url.searchParams.get("redirect_uri");
			if (url.searchParams.get("client_id") !== clientId || !redirectUri)
				return json(400, { error: "invalid_request" });
			const code = randomBytes(16).toString("hex");
			codes.set(code, {
				nonce: url.searchParams.get("nonce"),
				challenge: url.searchParams.get("code_challenge"),
				redirectUri,
			});
			const back = new URL(redirectUri);
			back.searchParams.set("code", code);
			const state = url.searchParams.get("state");
			if (state) back.searchParams.set("state", state);
			response.writeHead(302, { location: back.toString() });
			return response.end();
		}
		if (url.pathname === "/token" && request.method === "POST") {
			const body = await readBody(request);
			const client = clientCredentials(request, body);
			if (client.id !== clientId || client.secret !== clientSecret)
				return json(401, { error: "invalid_client" });
			const code = body.get("code") ?? "";
			const pending = codes.get(code);
			codes.delete(code);
			const verifier = body.get("code_verifier") ?? "";
			const challenge = createHash("sha256")
				.update(verifier)
				.digest("base64url");
			if (
				!pending ||
				pending.redirectUri !== body.get("redirect_uri") ||
				pending.challenge !== challenge
			)
				return json(400, { error: "invalid_grant" });
			const now = Math.floor(Date.now() / 1000);
			const { claims, key } = next;
			next = { claims: {} };
			const idToken = await new SignJWT({
				iss: issuer,
				sub: "synthetic-a",
				aud: clientId,
				iat: now,
				exp: now + 300,
				...(pending.nonce ? { nonce: pending.nonce } : {}),
				...claims,
			})
				.setProtectedHeader({ alg: "RS256", kid: KID })
				.sign(key === "other" ? other.privateKey : main.privateKey);
			return json(200, {
				access_token: randomBytes(16).toString("hex"),
				token_type: "Bearer",
				expires_in: 300,
				id_token: idToken,
			});
		}
		json(404, { error: "not_found" });
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	return {
		issuer,
		clientId,
		clientSecret,
		mint(claims, options) {
			next = options?.key ? { claims, key: options.key } : { claims };
		},
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}
