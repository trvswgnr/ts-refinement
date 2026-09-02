import { resolve } from "node:path";

import type { TtscPluginDescriptor, TtscPluginFactoryContext } from "./types.ts";

export default function refinementTransformPlugin(
  context: TtscPluginFactoryContext,
): TtscPluginDescriptor {
  return {
    name: "@ts-refinement/ttsc/transform",
    source: resolve(context.dirname, "../native/transform"),
    stage: "transform",
  };
}
