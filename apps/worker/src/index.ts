import { readConfig } from "@reo/config";

readConfig(process.env);
console.log(
	JSON.stringify({
		service: "worker",
		status: "disabled",
		reason: "foundation_pending",
		capabilities: [],
	}),
);
