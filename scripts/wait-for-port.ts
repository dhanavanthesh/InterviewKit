import net from "node:net";

// Waits until a local TCP port accepts connections, so dependent dev servers start in order.
const port = Number(process.argv[2] ?? 27017);
const deadline = Date.now() + 120_000;

function probe(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

while (!(await probe())) {
  if (Date.now() > deadline) {
    console.error(`Nothing is listening on port ${port} after two minutes.`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
