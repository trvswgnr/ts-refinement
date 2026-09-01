import plugin = require("ts-refinement-types/typescript-plugin");

declare const modules: Parameters<typeof plugin>[0];
const initialized = plugin(modules);

void initialized;
