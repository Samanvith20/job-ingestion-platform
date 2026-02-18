import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    _id: { type: String },           
    // identity
    job_id: { type: String, required: true },
    source: { type: String },
    source_url: { type: String },

    // normalized title
    job_title: { type: String, required: true },
    role_title: { type: String },   
    // company
    company_name: { type: String },

    // cleaned skills
    skills: {
      technical: [String],
      tools: [String],
      soft: [String]
    },

    // experience
    min_experience: Number,
    max_experience: Number,
    difficulty_level: String, // entry, mid, senior

    // salary
    salary_min: Number,
    salary_max: Number,
    salary_currency: String,
    salary_period: String,

    // location
    location: String,
    location_state: String,
    location_country: String,

    // job type
    job_type: String,
    work_mode: String,

    // industry
    industry: [String],

    // processed description
    description: String,
    extracted_by: String,  // Dates
    posted_at: { type: Date, default: null },
    expiry_at: { type: Date, default: null },

    is_published: { type: Boolean, default: false },
    is_ingested: {type:Boolean,default:false}
  },
  { collection: "jobs", timestamps: true }
);

export const Job = mongoose.model("Job", jobSchema);