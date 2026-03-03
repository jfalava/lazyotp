import { describe, expect, it } from "vitest";
import { parseArgv, readCliOptions } from "./argv.ts";

describe("parseArgv", () => {
  it("returns help when no args are passed", () => {
    expect(parseArgv([])).toEqual({
      command: "help",
      positional: [],
      options: {},
    });
  });

  it("normalizes command aliases and captures positional tokens", () => {
    expect(parseArgv(["gen", "github"])).toEqual({
      command: "code",
      positional: ["github"],
      options: {},
    });
  });

  it("parses long and short options", () => {
    expect(
      parseArgv(["code", "--service=otp", "-d", "8", "--period", "60"]),
    ).toEqual({
      command: "code",
      positional: [],
      options: {
        service: "otp",
        digits: "8",
        period: "60",
      },
    });
  });

  it("forces help command when --help is present", () => {
    expect(parseArgv(["code", "--help"])).toEqual({
      command: "help",
      positional: [],
      options: { help: true },
    });
  });

  it("throws on unknown command", () => {
    expect(() => parseArgv(["unknown"])).toThrow("Unknown command: unknown");
  });

  it("throws on short option without a value", () => {
    expect(() => parseArgv(["code", "-d"])).toThrow(
      "Missing value for option: -d",
    );
  });

  it("throws on long option without a value", () => {
    expect(() => parseArgv(["code", "--digits"])).toThrow(
      "Missing value for option: --digits",
    );
  });

  it("throws on unknown long option", () => {
    expect(() => parseArgv(["code", "--digitz", "6"])).toThrow(
      "Unknown option: --digitz",
    );
  });
});

describe("readCliOptions", () => {
  it("uses defaults when no options are provided", () => {
    expect(readCliOptions({})).toEqual({
      service: "lazyotp",
      alias: "default",
      oneOffSecret: undefined,
      digits: 6,
      period: 30,
    });
  });

  it("reads alias from --alias before --name", () => {
    expect(
      readCliOptions({
        alias: "primary",
        name: "legacy",
      }),
    ).toMatchObject({ alias: "primary" });
  });

  it("throws when alias is blank", () => {
    expect(() => readCliOptions({ alias: "   " })).toThrow(
      "--alias must not be empty",
    );
  });

  it("throws when --secret is passed without a value", () => {
    expect(() => readCliOptions({ secret: true })).toThrow(
      "--secret requires a value",
    );
  });

  it("throws for invalid digits and period", () => {
    expect(() => readCliOptions({ digits: "0" })).toThrow(
      "--digits must be a positive integer",
    );
    expect(() => readCliOptions({ digits: "11" })).toThrow(
      "--digits must be <= 10",
    );
    expect(() => readCliOptions({ period: "-1" })).toThrow(
      "--period must be a positive integer",
    );
  });
});
