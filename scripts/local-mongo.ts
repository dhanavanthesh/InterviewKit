import { mkdir } from "node:fs/promises";
import path from "node:path";

import { MongoMemoryServer } from "mongodb-memory-server-core";

const dbPath = path.resolve("tmp/mongodb");
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
