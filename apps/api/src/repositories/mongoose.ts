import { Types } from "mongoose";

import type { Kit, ProgressEvent, QuestionCategory, StructuredError } from "@interview-kit/schema";

import { JobModel, KitModel, PracticeReviewModel, UserModel } from "../models/index";
import type { JobRecord, JobStatus, KitRecord, PracticeReviewRecord, UserRecord } from "../types";
import type { Repositories } from "./repository";

interface RawUser {
  _id: Types.ObjectId;
  email: string;
  password_hash: string;
  token_version: number;
  created_at: Date;
  updated_at: Date;
}

interface RawKit {
  _id: Types.ObjectId;
  owner_id: Types.ObjectId;
  status: KitRecord["status"];
  version: number;
  dedupe_key: string;
  input: { jd: string; companyUrl: string; days: number };
  kit: Kit | null;
  counters: KitRecord["counters"];
  regenerating: string[];
  deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

interface RawJob {
  _id: Types.ObjectId;
  owner_id: Types.ObjectId;
  kit_id: Types.ObjectId;
  type: JobRecord["type"];
  section?: JobRecord["section"];
  category?: QuestionCategory;
  status: JobStatus;
  steps: ProgressEvent[];
  error: StructuredError | null;
  created_at: Date;
  started_at?: Date;
  finished_at?: Date;
  updated_at: Date;
}

interface RawReview {
  _id: Types.ObjectId;
  owner_id: Types.ObjectId;
  kit_id: Types.ObjectId;
  card_id: string;
  confidence: 1 | 2 | 3 | 4;
  reviewed_at: Date;
}

function objectId(value: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

function user(raw: RawUser): UserRecord {
  return {
    id: raw._id.toString(),
    email: raw.email,
    passwordHash: raw.password_hash,
    tokenVersion: raw.token_version,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function kit(raw: RawKit): KitRecord {
  return {
    id: raw._id.toString(),
    ownerId: raw.owner_id.toString(),
    status: raw.status,
    version: raw.version,
    dedupeKey: raw.dedupe_key,
    input: raw.input,
    kit: raw.kit,
    counters: raw.counters,
    regenerating: raw.regenerating,
    deleted: raw.deleted,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function job(raw: RawJob): JobRecord {
  return {
    id: raw._id.toString(),
    ownerId: raw.owner_id.toString(),
    kitId: raw.kit_id.toString(),
    type: raw.type,
    ...(raw.section === undefined ? {} : { section: raw.section }),
    ...(raw.category === undefined ? {} : { category: raw.category }),
    status: raw.status,
    steps: raw.steps,
    error: raw.error,
    createdAt: raw.created_at,
    ...(raw.started_at === undefined ? {} : { startedAt: raw.started_at }),
    ...(raw.finished_at === undefined ? {} : { finishedAt: raw.finished_at }),
    updatedAt: raw.updated_at,
  };
}

function review(raw: RawReview): PracticeReviewRecord {
  return {
    id: raw._id.toString(),
    ownerId: raw.owner_id.toString(),
    kitId: raw.kit_id.toString(),
    cardId: raw.card_id,
    confidence: raw.confidence,
    reviewedAt: raw.reviewed_at,
  };
}

export function createMongooseRepositories(): Repositories {
  return {
    users: {
      async create(email, passwordHash) {
        const created = await UserModel.create({
          email,
          password_hash: passwordHash,
          token_version: 0,
        });
        const raw = (await UserModel.findById(created._id)
          .select("+password_hash")
          .lean()) as unknown as RawUser;
        return user(raw);
      },
      async findByEmail(email) {
        const raw = (await UserModel.findOne({ email })
          .select("+password_hash")
          .lean()) as unknown as RawUser | null;
        return raw === null ? null : user(raw);
      },
      async findById(id) {
        const _id = objectId(id);
        if (_id === null) return null;
        const raw = (await UserModel.findById(_id)
          .select("+password_hash")
          .lean()) as unknown as RawUser | null;
        return raw === null ? null : user(raw);
      },
      async incrementTokenVersion(id) {
        const _id = objectId(id);
        if (_id !== null) await UserModel.updateOne({ _id }, { $inc: { token_version: 1 } });
      },
    },
    kits: {
      async create(input) {
        const created = await KitModel.create({
          owner_id: objectId(input.ownerId),
          status: input.status,
          version: input.version,
          dedupe_key: input.dedupeKey,
          input: input.input,
          kit: input.kit,
          counters: input.counters,
          regenerating: input.regenerating,
          deleted: input.deleted,
        });
        const raw = (await KitModel.findById(created._id).lean()) as unknown as RawKit;
        return kit(raw);
      },
      async findOwned(ownerId, id) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return null;
        const raw = (await KitModel.findOne({
          _id,
          owner_id,
          deleted: false,
        }).lean()) as unknown as RawKit | null;
        return raw === null ? null : kit(raw);
      },
      async findDuplicate(ownerId, dedupeKey) {
        const owner_id = objectId(ownerId);
        if (owner_id === null) return null;
        const raw = (await KitModel.findOne({
          owner_id,
          dedupe_key: dedupeKey,
          deleted: false,
        }).lean()) as unknown as RawKit | null;
        return raw === null ? null : kit(raw);
      },
      async listOwned(ownerId, limit) {
        const owner_id = objectId(ownerId);
        if (owner_id === null) return [];
        const raw = (await KitModel.find({ owner_id, deleted: false })
          .sort({ updated_at: -1 })
          .limit(limit)
          .lean()) as unknown as RawKit[];
        return raw.map(kit);
      },
      async compareAndSwap(ownerId, id, version, next) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return false;
        const result = await KitModel.updateOne(
          { _id, owner_id, deleted: false, version },
          {
            $set: {
              status: next.status,
              dedupe_key: next.dedupeKey,
              input: next.input,
              kit: next.kit,
              counters: next.counters,
            },
            $inc: { version: 1 },
          },
        );
        return result.modifiedCount === 1;
      },
      async deleteOwned(ownerId, id) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return false;
        const result = await KitModel.updateOne(
          { _id, owner_id, deleted: false },
          { $set: { deleted: true }, $inc: { version: 1 } },
        );
        return result.modifiedCount === 1;
      },
      async setGenerationResult(ownerId, id, value) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return false;
        const result = await KitModel.updateOne(
          { _id, owner_id, deleted: false },
          { $set: { kit: value, status: "ready" }, $inc: { version: 1 } },
        );
        return result.modifiedCount === 1;
      },
      async setStatus(ownerId, id, status) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return false;
        const result = await KitModel.updateOne(
          { _id, owner_id, deleted: false },
          { $set: { status } },
        );
        return result.modifiedCount === 1;
      },
      async claimSection(ownerId, id, section) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return false;
        const result = await KitModel.updateOne(
          { _id, owner_id, deleted: false, regenerating: { $ne: section } },
          { $addToSet: { regenerating: section } },
        );
        return result.modifiedCount === 1;
      },
      async releaseSection(ownerId, id, section) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id !== null && _id !== null)
          await KitModel.updateOne({ _id, owner_id }, { $pull: { regenerating: section } });
      },
    },
    jobs: {
      async create(input) {
        const created = await JobModel.create({
          owner_id: objectId(input.ownerId),
          kit_id: objectId(input.kitId),
          type: input.type,
          ...(input.section === undefined ? {} : { section: input.section }),
          ...(input.category === undefined ? {} : { category: input.category }),
          status: input.status,
          steps: input.steps,
          error: input.error,
        });
        const raw = (await JobModel.findById(created._id).lean()) as unknown as RawJob;
        return job(raw);
      },
      async findOwned(ownerId, id) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return null;
        const raw = (await JobModel.findOne({ _id, owner_id }).lean()) as unknown as RawJob | null;
        return raw === null ? null : job(raw);
      },
      async findLatestForKit(ownerId, kitId) {
        const owner_id = objectId(ownerId);
        const kit_id = objectId(kitId);
        if (owner_id === null || kit_id === null) return null;
        const raw = (await JobModel.findOne({ owner_id, kit_id })
          .sort({ created_at: -1 })
          .lean()) as unknown as RawJob | null;
        return raw === null ? null : job(raw);
      },
      async transition(ownerId, id, from, to) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return false;
        const result = await JobModel.updateOne(
          { _id, owner_id, status: { $in: from } },
          { $set: { status: to, ...(to === "running" ? { started_at: new Date() } : {}) } },
        );
        return result.modifiedCount === 1;
      },
      async requeue(ownerId, id) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return false;
        const result = await JobModel.updateOne(
          { _id, owner_id, status: { $in: ["failed", "interrupted"] } },
          {
            $set: { status: "queued", error: null, steps: [] },
            $unset: { started_at: "", finished_at: "" },
          },
        );
        return result.modifiedCount === 1;
      },
      async addProgress(ownerId, id, event) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id === null || _id === null) return;
        await JobModel.updateOne({ _id, owner_id }, [
          {
            $set: {
              steps: {
                $concatArrays: [
                  {
                    $filter: {
                      input: "$steps",
                      as: "existing",
                      cond: { $ne: ["$$existing.step", event.step] },
                    },
                  },
                  [{ $literal: event }],
                ],
              },
            },
          },
        ]);
      },
      async finish(ownerId, id, status, error) {
        const owner_id = objectId(ownerId);
        const _id = objectId(id);
        if (owner_id !== null && _id !== null) {
          await JobModel.updateOne(
            { _id, owner_id },
            { $set: { status, error, finished_at: new Date() } },
          );
        }
      },
      async interruptStale() {
        const result = await JobModel.updateMany(
          { status: { $in: ["queued", "running"] } },
          { $set: { status: "interrupted", finished_at: new Date() } },
        );
        return result.modifiedCount;
      },
      async listInterruptedRegenerations() {
        const raw = (await JobModel.find({
          type: "regenerate",
          status: "interrupted",
        }).lean()) as unknown as RawJob[];
        return raw.map(job);
      },
      async deleteForKit(ownerId, kitId) {
        const owner_id = objectId(ownerId);
        const kit_id = objectId(kitId);
        if (owner_id !== null && kit_id !== null) await JobModel.deleteMany({ owner_id, kit_id });
      },
    },
    reviews: {
      async create(input) {
        const created = await PracticeReviewModel.create({
          owner_id: objectId(input.ownerId),
          kit_id: objectId(input.kitId),
          card_id: input.cardId,
          confidence: input.confidence,
          reviewed_at: input.reviewedAt,
        });
        const raw = (await PracticeReviewModel.findById(
          created._id,
        ).lean()) as unknown as RawReview;
        return review(raw);
      },
      async listOwned(ownerId, kitId) {
        const owner_id = objectId(ownerId);
        const kit_id = objectId(kitId);
        if (owner_id === null || kit_id === null) return [];
        const raw = (await PracticeReviewModel.find({ owner_id, kit_id })
          .sort({ reviewed_at: 1 })
          .lean()) as unknown as RawReview[];
        return raw.map(review);
      },
      async deleteForCard(ownerId, kitId, cardId) {
        const owner_id = objectId(ownerId);
        const kit_id = objectId(kitId);
        if (owner_id !== null && kit_id !== null)
          await PracticeReviewModel.deleteMany({ owner_id, kit_id, card_id: cardId });
      },
      async deleteForKit(ownerId, kitId) {
        const owner_id = objectId(ownerId);
        const kit_id = objectId(kitId);
        if (owner_id !== null && kit_id !== null)
          await PracticeReviewModel.deleteMany({ owner_id, kit_id });
      },
    },
  };
}
