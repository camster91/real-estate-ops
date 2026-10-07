import Fastify from "fastify";
export function createServer() {
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
	app.setErrorHandler((_error, _request, reply) =>
		reply.code(500).send({ error: "internal_error" }),
	);
	return app;
}
