import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const paths = execFileSync(
	"git",
	["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
	{ encoding: "utf8" },
)
	.split("\0")
	.filter(Boolean)
	// Tracked files deleted from the working tree have nothing to scan.
	.filter((path) => existsSync(path));
const patterns = [
	new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
	new RegExp("gh[pousr]_" + "[A-Za-z0-9]{30,}"),
	new RegExp("AKIA" + "[0-9A-Z]{16}"),
];
const violations = [...new Set(paths)].filter(
	(path) =>
		(/(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith(".example")) ||
		patterns.some((pattern) => pattern.test(readFileSync(path, "utf8"))),
);
if (violations.length) {
	console.error("Potential credentials in paths:", violations.join(", "));
	process.exitCode = 1;
} else
	console.log(
		"Tracked/source credential-pattern check passed (limited coverage).",
	);
