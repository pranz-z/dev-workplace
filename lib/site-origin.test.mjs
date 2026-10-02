import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./site-origin.ts", import.meta.url), "utf8").replace('import "server-only";', "");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const siteOrigin = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("site origin uses validated configuration or trusted platform/local defaults", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    vercelUrl: process.env.VERCEL_URL,
  };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://workplace.example/";
    assert.equal(siteOrigin.getApplicationOrigin(), "https://workplace.example");
    process.env.NEXT_PUBLIC_SITE_URL = "https://evil.example/path";
    assert.equal(siteOrigin.getApplicationOrigin(), null);
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_URL = "preview-workplace.vercel.app";
    assert.equal(siteOrigin.getApplicationOrigin(), "https://preview-workplace.vercel.app");
    process.env.VERCEL_URL = "attacker.example";
    assert.equal(siteOrigin.getApplicationOrigin(), null);
    process.env.NODE_ENV = "development";
    assert.equal(siteOrigin.getApplicationOrigin(), "http://localhost:3000");
  } finally {
    for (const [name, value] of [["NODE_ENV", previous.nodeEnv], ["NEXT_PUBLIC_SITE_URL", previous.siteUrl], ["VERCEL_URL", previous.vercelUrl]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
