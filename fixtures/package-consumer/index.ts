import * as ts from "typescript";

import type { Refined } from "ts-refinement-types";
import { parsePredicate } from "ts-refinement-types/analyzer";
import refinementTypes from "ts-refinement-types/rolldown";
import { RefinementError } from "ts-refinement-types/runtime";

type Positive = Refined<number, "n > 0">;

declare const positive: Positive;
const numberValue: number = positive;
const parsed = parsePredicate(ts, "n > 0");
const plugin = refinementTypes();
const error = new RefinementError({ predicate: "n > 0", value: numberValue });

void parsed;
void plugin;
void error;
