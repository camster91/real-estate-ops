import { readConfig } from "@reo/config";
import { createServer } from "./server.js";

const config = readConfig(process.env);
const app = createServer();
for (const signal of ["SIGTERM", "SIGINT"] as const)
	process.once(signal, () => {
		void app.close();
	});
await app.listen({ port: config.port, host: config.host });
