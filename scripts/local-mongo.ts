import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoMemoryServer } from "mongodb-memory-server-core";

// Data lives at the repository root so every workspace shares one local database.
const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tmp/mongodb");

const inUse = await new Promise<boolean>((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port: 27017 });
  socket.once("connect", () => {
    socket.end();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
});
if (inUse) {
  console.log("A MongoDB instance is already listening at 127.0.0.1:27017.");
  setInterval(() => undefined, 60_000);
} else {
  await startLocalMongo();
}

async function startLocalMongo(): Promise<void> {
  await mkdir(dbPath, { recursive: true });
  const mongo = await MongoMemoryServer.create({
    binary: { version: "7.0.14" },
    instance: {
      ip: "127.0.0.1",
      port: 27017,
      portGeneration: false,
      dbPath,
      storageEngine: "wiredTiger",
    },
  });
  console.log("Local MongoDB is listening at 127.0.0.1:27017.");
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void mongo.stop({ doCleanup: false }).then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
