import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import pg from "pg";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(TESTS_DIR, "../../../../../");
export const DB_PACKAGE_DIR = path.join(WORKSPACE_ROOT, "lib", "db");
export const API_SERVER_DIR = path.join(WORKSPACE_ROOT, "artifacts", "api-server");

function findPostgresBinary(name: string): string | undefined {
  const directCandidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, name));

  directCandidates.push(path.join("/usr/local/pgsql/bin", name));

  const executable = directCandidates.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (executable) return executable;

  for (const root of ["/nix/store", "/usr/lib/postgresql"]) {
    try {
      for (const entry of readdirSync(root).filter((directory) =>
        root === "/nix/store"
          ? directory.toLowerCase().includes("postgresql")
          : true,
      )) {
        const candidate = path.join(root, entry, "bin", name);
        try {
          accessSync(candidate, constants.X_OK);
          return candidate;
        } catch {
          // Try the next installed PostgreSQL version.
        }
      }
    } catch {
      // This PostgreSQL install location is optional.
    }
  }
  return undefined;
}

const initdbPath = findPostgresBinary("initdb");
const pgCtlPath = findPostgresBinary("pg_ctl");

export const postgresToolsAvailable = Boolean(initdbPath && pgCtlPath);

function sanitizedPostgresEnv(binaryDirectory: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  env.PATH = [binaryDirectory, env.PATH].filter(Boolean).join(path.delimiter);
  return env;
}

export function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 60_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function reserveLocalPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve an ephemeral PostgreSQL port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function assertCommandSucceeded(
  result: CommandResult,
  commandName: string,
): void {
  if (result.code !== 0) {
    throw new Error(
      `${commandName} failed (code ${result.code}, signal ${result.signal}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

export class EphemeralPostgres {
  readonly adminUrl: string;
  private readonly dataDirectory: string;
  private readonly binaryDirectory: string;
  private readonly env: NodeJS.ProcessEnv;
  private started = false;

  private constructor(
    dataDirectory: string,
    port: number,
    binaryDirectory: string,
  ) {
    this.dataDirectory = dataDirectory;
    this.binaryDirectory = binaryDirectory;
    this.env = sanitizedPostgresEnv(binaryDirectory);
    this.adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  }

  static async start(): Promise<EphemeralPostgres> {
    if (!initdbPath || !pgCtlPath) {
      throw new Error("PostgreSQL initdb and pg_ctl are required to start the test cluster");
    }

    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), "db-bootstrap-regression-"),
    );
    const binaryDirectory = path.dirname(initdbPath);
    try {
      const cluster = new EphemeralPostgres(
        dataDirectory,
        await reserveLocalPort(),
        binaryDirectory,
      );

      const initialize = await runCommand(
        initdbPath,
        [
          "-D",
          dataDirectory,
          "--no-locale",
          "-E",
          "UTF8",
          "--auth-local=trust",
          "--auth-host=trust",
          "-U",
          "postgres",
        ],
        { env: cluster.env },
      );
      assertCommandSucceeded(initialize, "initdb");

      const start = await runCommand(
        pgCtlPath,
        [
          "-D",
          dataDirectory,
          "-l",
          path.join(dataDirectory, "postgres.log"),
          "-o",
          `-h 127.0.0.1 -p ${new URL(cluster.adminUrl).port} -k ${dataDirectory}`,
          "-w",
          "start",
        ],
        { env: cluster.env },
      );
      assertCommandSucceeded(start, "pg_ctl start");
      cluster.started = true;
      return cluster;
    } catch (error) {
      const log = await readFile(path.join(dataDirectory, "postgres.log"), "utf8")
        .catch(() => "");
      await rm(dataDirectory, { recursive: true, force: true });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${log ? `\n${log}` : ""}`,
        { cause: error },
      );
    }
  }

  databaseUrl(databaseName: string): string {
    const url = new URL(this.adminUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
  }

  async createDatabase(databaseName: string): Promise<string> {
    const client = new pg.Client({ connectionString: this.adminUrl });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE "${databaseName}"`);
    } finally {
      await client.end();
    }
    return this.databaseUrl(databaseName);
  }

  newDatabaseName(label: string): string {
    return `dbtest_${label}_${process.pid}_${randomBytes(3).toString("hex")}`;
  }

  async stopAndRemove(): Promise<void> {
    if (this.started && pgCtlPath) {
      const stop = await runCommand(
        pgCtlPath,
        ["-D", this.dataDirectory, "-m", "immediate", "-w", "stop"],
        { env: this.env },
      );
      assertCommandSucceeded(stop, "pg_ctl stop");
      this.started = false;
    }
    await rm(this.dataDirectory, { recursive: true, force: true });
  }
}