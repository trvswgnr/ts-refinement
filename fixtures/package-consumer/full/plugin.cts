import plugin = require("@ts-refinement/typescript-plugin");

declare const modules: Parameters<typeof plugin>[0];
const initialized = plugin(modules);

void initialized;
