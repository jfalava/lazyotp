#!/usr/bin/env bun

import { runCli } from "./src/main.ts";
import { isInteractionNotAllowedError } from "./src/shared/errors.ts";

function readRuntimeArgv(): string[] {
  const maybeBun = Reflect.get(globalThis, "Bun") as { argv?: string[] } | undefined;
  return maybeBun?.argv?.slice(2) ?? process.argv.slice(2);
}

await runCli(readRuntimeArgv()).catch((error: unknown) => {
  if (isInteractionNotAllowedError(error)) {
    console.error(
      "Error: Bun Secrets could not access the OS credential manager in this environment. " +
        "Run this CLI in a normal local terminal session with Keychain/libsecret/Credential Manager access.",
    );
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
