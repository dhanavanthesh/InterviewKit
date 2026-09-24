import mongoose, { Schema, type Model } from "mongoose";

interface UserDocument {
  email: string;
  password_hash: string;
  token_version: number;
  created_at: Date;
  updated_at: Date;
}

interface KitDocument {
  owner_id: Schema.Types.ObjectId;
  status: string;
  version: number;
  dedupe_key: string;
  input: unknown;
  kit: unknown;
  counters: unknown;
  regenerating: string[];
  deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

interface JobDocument {
  owner_id: Schema.Types.ObjectId;
  kit_id: Schema.Types.ObjectId;
  type: string;
  section?: string;
  category?: string;
  status: string;
  steps: unknown[];
  error: unknown;
  started_at?: Date;
  finished_at?: Date;
  created_at: Date;
  updated_at: Date;
}

interface ReviewDocument {
  owner_id: Schema.Types.ObjectId;
  kit_id: Schema.Types.ObjectId;
  card_id: string;
  confidence: number;
  reviewed_at: Date;
}

const timestamps = { createdAt: "created_at", updatedAt: "updated_at" } as const;

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    password_hash: { type: String, required: true, select: false },
    token_version: { type: Number, required: true, default: 0 },
  },
  { timestamps, versionKey: false },
);

const kitSchema = new Schema(
  {
    owner_id: { type: Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, enum: ["generating", "ready", "failed"], required: true },
    version: { type: Number, required: true, default: 0 },
    dedupe_key: { type: String, required: true },
    input: { type: Schema.Types.Mixed, required: true },
    kit: { type: Schema.Types.Mixed, default: null },
    counters: { type: Schema.Types.Mixed, required: true },
    regenerating: { type: [String], default: [] },
    deleted: { type: Boolean, default: false },
  },
  { timestamps, versionKey: false },
);
kitSchema.index({ owner_id: 1, updated_at: -1 });
kitSchema.index(
  { owner_id: 1, dedupe_key: 1 },
  { unique: true, partialFilterExpression: { deleted: false } },
);

const jobSchema = new Schema(
  {
    owner_id: { type: Schema.Types.ObjectId, required: true, index: true },
    kit_id: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, enum: ["create", "regenerate"], required: true },
    section: { type: String },
    category: { type: String },
    status: {
      type: String,
      enum: ["queued", "running", "done", "failed", "interrupted"],
      required: true,
    },
    steps: { type: [Schema.Types.Mixed], default: [] },
    error: { type: Schema.Types.Mixed, default: null },
    started_at: { type: Date },
    finished_at: { type: Date },
  },
  { timestamps, versionKey: false },
);
jobSchema.index({ owner_id: 1, status: 1 });

const reviewSchema = new Schema(
  {
    owner_id: { type: Schema.Types.ObjectId, required: true, index: true },
    kit_id: { type: Schema.Types.ObjectId, required: true, index: true },
    card_id: { type: String, required: true },
    confidence: { type: Number, required: true, min: 1, max: 4 },
    reviewed_at: { type: Date, required: true },
  },
  { versionKey: false },
);
reviewSchema.index({ owner_id: 1, kit_id: 1 });
reviewSchema.index({ kit_id: 1, card_id: 1, reviewed_at: -1 });

export const UserModel: Model<UserDocument> =
  (mongoose.models.User as Model<UserDocument> | undefined) ??
  mongoose.model<UserDocument>("User", userSchema);
export const KitModel: Model<KitDocument> =
  (mongoose.models.Kit as Model<KitDocument> | undefined) ??
  mongoose.model<KitDocument>("Kit", kitSchema);
export const JobModel: Model<JobDocument> =
  (mongoose.models.Job as Model<JobDocument> | undefined) ??
  mongoose.model<JobDocument>("Job", jobSchema);
export const PracticeReviewModel: Model<ReviewDocument> =
  (mongoose.models.PracticeReview as Model<ReviewDocument> | undefined) ??
  mongoose.model<ReviewDocument>("PracticeReview", reviewSchema);
