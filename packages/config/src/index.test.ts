import { describe, expect, it } from "vitest";
import { readConfig } from "./index.js";

describe("safe runtime configuration", () => {
	it("defaults to loopback development", () =>
		expect(readConfig({})).toEqual({
			port: 4000,
			host: "127.0.0.1",
			mode: "development",
		}));
	it.each(["0", "65536", "4.2", "-1", "4000bad", ""])(
		"rejects invalid port %s",
		(port) => expect(() => readConfig({ PORT: port })).toThrow(),
	);
	it("refuses premature production", () =>
		expect(() => readConfig({ NODE_ENV: "production" })).toThrow());
	it("refuses external binding", () =>
		expect(() => readConfig({ HOST: "0.0.0.0" })).toThrow());
});
