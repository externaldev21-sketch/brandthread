/**
 * Background removal for /api/bg-removal/remove. Runs the self-hosted segmenter
 * in a forked child (dist/bgRemovalWorker.mjs) that is kept warm between
 * requests and shut down after BG_REMOVAL_IDLE_MS of quiet, which returns the
 * model's memory to the machine. Under tsx/vitest (no built worker next to this
 * module) it runs in-process instead.
 */
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeBackground as removeInProcess, type CutoutResult } from "./segmenter";

export { bgModelName, ensureBgModel, type CutoutResult } from "./segmenter";

const TIMEOUT_MS = 120_000;
const IDLE_MS = Number(process.env.BG_REMOVAL_IDLE_MS) || 10 * 60_000;

function workerPath(): string | null {
  const candidate = path.join(path.dirname(fileURLToPath(import.meta.url)), "bgRemovalWorker.mjs");
  return fs.existsSync(candidate) ? candidate : null;
}

type Pending = { resolve: (r: CutoutResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
let child: ChildProcess | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(err: Error) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
    pending.delete(id);
  }
}

function getChild(file: string): ChildProcess {
  if (child && child.connected) return child;
  const proc = fork(file, [], {
    serialization: "advanced",
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    // Not the parent's flags: the worker is a plain bundle and needs none of them.
    execArgv: ["--enable-source-maps"],
  });
  proc.on("message", (msg: { id: number; ok: boolean; error?: string } & Partial<CutoutResult>) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok && msg.png) {
      p.resolve({ png: Buffer.from(msg.png), width: msg.width!, height: msg.height!, coverage: msg.coverage!, model: msg.model! });
    } else {
      p.reject(new Error(msg.error ?? "Background removal failed"));
    }
    scheduleIdle();
  });
  proc.on("exit", (code, signal) => {
    if (child === proc) child = null;
    failAll(new Error(`Background-removal worker exited (${signal ?? code})`));
  });
  child = proc;
  return proc;
}

function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size === 0 && child) {
      child.kill();
      child = null;
    }
  }, IDLE_MS);
  idleTimer.unref();
}

export function removeBackground(image: Buffer): Promise<CutoutResult> {
  const file = workerPath();
  if (!file) return removeInProcess(image);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Background removal timed out"));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    if (idleTimer) clearTimeout(idleTimer);
    getChild(file).send({ id, image });
  });
}
