import cookie from "@fastify/cookie";
import Fastify, { type FastifyError } from "fastify";
import { originGuard } from "./auth/guard.js";
import { type AuthOptions, registerAuthRoutes } from "./auth/routes.js";

export function createServer(options: { auth?: AuthOptions } = {}) {
	const app = Fastify({
		logger: {
			redact: [
				"req.headers.authorization",
				"req.headers.cookie",
				"res.headers.set-cookie",
			],
			serializers: {
				req: (req) => ({ method: req.method }),
				res: (res) => ({ statusCode: res.statusCode }),
			},
		},
	});
	const { auth } = options;
	if (auth) {
		// Signs the short-lived login cookie with REO_LOGIN_COOKIE_SECRET.
		app.register(cookie, { secret: auth.config.cookieSecret });
		// Root-level so it covers every /v1 route, including the catch-all.
		app.addHook("onRequest", originGuard(auth.config.publicUrl));
		app.register(registerAuthRoutes, auth);
	}
	app.get("/health/live", async () => ({ status: "alive" }));
	app.get("/health/ready", async (_request, reply) =>
		reply.code(503).send({ status: "not_ready" }),
	);
	app.all("/v1/*", async (_request, reply) =>
		reply.code(401).send({ error: "authentication_required" }),
	);
	app.setNotFoundHandler((_request, reply) =>
		reply.code(404).send({ error: "not_found" }),
	);
	app.setErrorHandler<FastifyError>((error, request, reply) => {
		const status = error.statusCode ?? 500;
		if (status >= 400 && status < 500) {
			// Client errors log only the code; messages can echo request content.
			request.log.info(
				{ code: error.code, statusCode: status },
				"request rejected",
			);
			return reply.code(status).send({ error: "bad_request" });
		}
		request.log.error({ err: error }, "request failed");
		return reply.code(500).send({ error: "internal_error" });
	});
	return app;
}
