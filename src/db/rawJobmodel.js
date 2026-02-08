import mongoose from "mongoose";

const rawJobSchema = new mongoose.Schema(
  {
    rawData: mongoose.Schema.Types.Mixed,

    externalId: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      required: true,
    },

    status: String,
  },
  {
    timestamps: true,
    collection: 'raw_jobs',
  }
);

export const RawJob = mongoose.model("RawJob", rawJobSchema);