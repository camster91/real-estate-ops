import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const listFiles = (args) =>
	execFileSync("git", ["ls-files", "-z", ...args], { encoding: "utf8" })
		.split("\0")
		.filter(Boolean);
const staged = new Set(listFiles(["--cached"]));
const paths = new Set([
	...staged,
	...listFiles(["--others", "--exclude-standard"]),
]);
const patterns = [
	new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
	new RegExp("gh[pousr]_" + "[A-Za-z0-9]{30,}"),
	new RegExp("AKIA" + "[0-9A-Z]{16}"),
];
// Scan the working copy and the staged blob: either can be committed, and a
// staged file may be missing from (or differ from) the working tree.
const versions = (path) => [
	...(existsSync(path) ? [readFileSync(path, "utf8")] : []),
	...(staged.has(path)
		? [
				execFileSync("git", ["show", `:${path}`], {
					encoding: "utf8",
					maxBuffer: 64 * 1024 * 1024,
				}),
			]
		: []),
];
const violations = [...paths].filter(
	(path) =>
		(/(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith(".example")) ||
		versions(path).some((text) =>
			patterns.some((pattern) => pattern.test(text)),
		),
);
if (violations.length) {
	console.error("Potential credentials in paths:", violations.join(", "));
	process.exitCode = 1;
} else
	console.log(
		"Tracked/source credential-pattern check passed (limited coverage).",
	);
