import { describe, expect, it } from "vitest";
import {
	canMoveDeal,
	DEAL_STAGES,
	type DealStage,
	formatAddress,
	parseNewDeal,
	parseStageChange,
} from "./deal.js";

const id = "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a";
const c1 = "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f";
const c2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const valid = (overrides: Record<string, unknown> = {}) => ({
	id,
	side: "buyer",
	address: {
		street: " 12 Main Street ",
		unit: "4",
		city: "Ottawa",
		postalCode: "k1a0b1",
	},
	clientIds: [c1],
	...overrides,
});

const withAddress = (overrides: Record<string, unknown>) =>
	valid({ address: { ...valid().address, ...overrides } });

describe("parseNewDeal", () => {
	it("accepts and normalises a deal", () => {
		expect(parseNewDeal(valid({ clientIds: [c1.toUpperCase(), c2] }))).toEqual({
			ok: true,
			deal: {
				id,
				side: "buyer",
				address: {
					street: "12 Main Street",
					unit: "4",
					city: "Ottawa",
					postalCode: "K1A 0B1",
				},
				clientIds: [c2, c1],
			},
		});
	});

	it.each([undefined, null, "", "  "])("treats unit %j as none", (unit) => {
		const result = parseNewDeal(withAddress({ unit }));
		expect(result.ok && result.deal.address.unit).toBe(null);
	});

	it.each(["K1A 0B1", "m5v3l9", " L4C 9Z9 ", "P0A 1A0", "N2L 3G1"])(
		"accepts the Ontario postal code %s",
		(postalCode) => {
			expect(parseNewDeal(withAddress({ postalCode })).ok).toBe(true);
		},
	);

	it.each<[string, unknown, string]>([
		["a bad id", valid({ id: "nope" }), "id"],
		["an unknown side", valid({ side: "agent" }), "side"],
		["no address", valid({ address: undefined }), "body"],
		["an extra address key", withAddress({ province: "BC" }), "body"],
		["an extra key", valid({ price: 1 }), "body"],
		["an empty street", withAddress({ street: " " }), "street"],
		["a street with a newline", withAddress({ street: "1 A\nSt" }), "street"],
		["a long street", withAddress({ street: "x".repeat(201) }), "street"],
		["a long unit", withAddress({ unit: "x".repeat(21) }), "unit"],
		["a unit with a tab", withAddress({ unit: "4\t5" }), "unit"],
		["no city", withAddress({ city: "" }), "city"],
		["a BC postal code", withAddress({ postalCode: "V6B 1A1" }), "postalCode"],
		["a US ZIP code", withAddress({ postalCode: "90210" }), "postalCode"],
		[
			"a postal code with O",
			withAddress({ postalCode: "K1O 0B1" }),
			"postalCode",
		],
		["two spaces", withAddress({ postalCode: "K1A  0B1" }), "postalCode"],
		["no clients", valid({ clientIds: [] }), "clientIds"],
		["five clients", valid({ clientIds: Array(5).fill(c1) }), "clientIds"],
		[
			"a repeated client",
			valid({ clientIds: [c1, c1.toUpperCase()] }),
			"clientIds",
		],
		["a bad client id", valid({ clientIds: ["x"] }), "clientIds"],
		["clientIds not a list", valid({ clientIds: c1 }), "clientIds"],
		["not an object", [], "body"],
	])("rejects %s", (_label, input, field) => {
		expect(parseNewDeal(input)).toEqual({ ok: false, field });
	});
});

describe("canMoveDeal", () => {
	const all = DEAL_STAGES as readonly DealStage[];
	it("open deals move anywhere but draft or where they are", () => {
		for (const from of ["draft", "active", "conditional", "firm"] as const)
			for (const to of all)
				expect(canMoveDeal(from, to), `${from} -> ${to}`).toBe(
					to !== from && to !== "draft",
				);
	});
	it("a closed deal never moves", () => {
		for (const to of all) expect(canMoveDeal("closed", to)).toBe(false);
	});
	it("a deal that fell through only reopens as active", () => {
		for (const to of all)
			expect(canMoveDeal("fell_through", to)).toBe(to === "active");
	});
});

describe("parseStageChange", () => {
	it("accepts a stage and version", () => {
		expect(parseStageChange({ stage: "firm", version: 3 })).toEqual({
			ok: true,
			stage: "firm",
			version: 3,
		});
	});
	it.each<[unknown, string]>([
		[{ stage: "won", version: 1 }, "stage"],
		[{ stage: "firm", version: 0 }, "version"],
		[{ stage: "firm", version: 1.5 }, "version"],
		[{ stage: "firm", version: 1, note: "x" }, "body"],
		[null, "body"],
	])("rejects %j", (input, field) => {
		expect(parseStageChange(input)).toEqual({ ok: false, field });
	});
});

describe("formatAddress", () => {
	it("joins the parts on one line", () => {
		expect(
			formatAddress({
				street: "12 Main Street",
				unit: "4",
				city: "Ottawa",
				postalCode: "K1A 0B1",
			}),
		).toBe("12 Main Street, Unit 4, Ottawa ON K1A 0B1");
		expect(
			formatAddress({
				street: "1 King St W",
				unit: null,
				city: "Toronto",
				postalCode: "M5H 1A1",
			}),
		).toBe("1 King St W, Toronto ON M5H 1A1");
	});
});
