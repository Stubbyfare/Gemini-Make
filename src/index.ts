import { mkdir, readFile, readdir, realpath, stat, writeFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { GoogleGenAI, FunctionCallingConfigMode, Type } from "@google/genai";

const DEFAULT_MODEL = "gemini-2.5-flash";
type AuthMode = "api-key" | "google";
type ToolCall = { name?: string; args?: Record<string, unknown> };

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const auth: AuthMode = (option("--auth") ?? (process.env.GEMINI_API_KEY ? "api-key" : "google")) as AuthMode;
if (auth !== "api-key" && auth !== "google") throw new Error("--auth must be api-key or google");
const workspace = await realpath(resolve(option("--workspace") ?? process.cwd())).catch(async () => {
  const path = resolve(option("--workspace") ?? process.cwd());
  await mkdir(path, { recursive: true });
  return realpath(path);
});
const model = auth === "api-key" ? (process.env.GEMINI_MODEL || DEFAULT_MODEL) : (process.env.GEMINI_MODEL || DEFAULT_MODEL);
const ai = auth === "api-key"
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env GOOGLE_CLOUD_LOCATION || "global" });

const toolDeclarations = [
  { name: "list_files", description: "List files in a workspace-relative directory.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Relative directory, usually ." } }, required: ["path"] } },
  { name: "read_file", description: "Read a UTF-8 text file in the workspace.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } },
  { name: "create_file", description: "Create or replace a UTF-8 text file in the workspace.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["path", "content"] } },
  { name: "delete_file", description: "Delete a file in the workspace after user confirmation.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } }
];

function safePath(inputPath: unknown): string {
  if (typeof inputPath !== "string" || !inputPath.trim()) throw new Error("A non-empty path is required");
  const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(workspace, inputPath);
  const rel = relative(workspace, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path must stay inside the workspace");
  return candidate;
}
async function confirm(rl: ReturnType<typeof createInterface>, message: string): Promise<boolean> {
  return (await rl.question(`${message} [y/N] `)).trim().toLowerCase() === "y";
}
async function runTool(call: ToolCall, rl: ReturnType<typeof createInterface>): Promise<unknown> {
  const name = call.name ?? "";
  const args = call.args ?? {};
  if (name === "list_files") {
    const path = safePath(args.path ?? ".");
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => `${entry.isDirectory() ? "[dir] " : "      "}${entry.name}`);
  }
  if (name === "read_file") return await readFile(safePath(args.path), "utf8");
  if (name === "create_file") {
    const path = safePath(args.path);
    const content = typeof args.content === "string" ? args.content : "";
    if (!await confirm(rl, `Allow Gemini to write ${relative(workspace, path)}?`)) return "User denied write";
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    return `Wrote ${relative(workspace, path)} (${content.length} bytes)`;
  }
  if (name === "delete_file") {
    const path = safePath(args.path);
    if ((await stat(path)).isDirectory()) throw new Error("Directories cannot be deleted by this tool");
    if (!await confirm(rl, `Allow Gemini to delete ${relative(workspace, path)}?`)) return "User denied deletion";
    await unlink(path);
    return `Deleted ${relative(workspace, path)}`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

const system = `You are Gemini Make, a careful local coding assistant. You can inspect and modify files only through the provided tools. Never invent successful file operations. Use workspace-relative paths, explain your plan briefly, and make focused changes. The workspace is ${workspace}.`;
const history: Array<{ role: "user" | "model"; parts: Array<{ text?: string; functionCall?: ToolCall; functionResponse?: { name: string; response: unknown } }> }> = [];
const rl = createInterface({ input, output });
console.log(`Gemini Make — ${auth} auth — model locked to ${model}`);
console.log(`Workspace: ${workspace}\nType /help for commands.`);
try {
  while (true) {
    const prompt = (await rl.question("> ")).trim();
    if (!prompt) continue;
    if (prompt === "/exit" || prompt === "/quit") break;
    if (prompt === "/help") { console.log("Enter a request, /model, /workspace, /clear, or /exit."); continue; }
    if (prompt === "/model") { console.log(`Active model: ${model} (locked in ${auth} mode)`); continue; }
    if (prompt === "/workspace") { console.log(workspace); continue; }
    if (prompt === "/clear") { history.length = 0; console.log("Conversation cleared."); continue; }
    history.push({ role: "user", parts: [{ text: prompt }] });
    let finished = false;
    for (let turn = 0; turn < 8 && !finished; turn++) {
      const response = await ai.models.generateContent({ model, contents: history, config: { systemInstruction: system, tools: [{ functionDeclarations: toolDeclarations }], toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } } });
      const calls = response.functionCalls ?? [];
      if (!calls.length) { console.log(response.text || "(No response)"); history.push({ role: "model", parts: [{ text: response.text || "" }] }); finished = true; continue; }
      history.push({ role: "model", parts: calls.map((call) => ({ functionCall: call })) });
      const results = [];
      for (const call of calls) {
        try { results.push({ name: call.name ?? "unknown", response: await runTool(call, rl) }); }
        catch (error) { results.push({ name: call.name ?? "unknown", response: `Tool error: ${error instanceof Error ? error.message : String(error)}` }); }
      }
      history.push({ role: "user", parts: results.map((result) => ({ functionResponse: result })) });
    }
  }
} finally { rl.close(); }
