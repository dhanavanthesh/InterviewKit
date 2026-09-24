import mongoose from "mongoose";

export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
}

export async function closeDatabase(): Promise<void> {
  await mongoose.disconnect();
}
