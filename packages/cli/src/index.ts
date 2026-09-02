#!/usr/bin/env node

import { runCli } from "./cli.ts";

process.exitCode = runCli(process.argv.slice(2));
