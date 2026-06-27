# GraphCareers Jobs Scraper

> A production-grade, multi-source job scraping pipeline that aggregates job listings from major Indian job portals, normalizes them into a knowledge graph, and powers AI-driven career intelligence.

---

## What Is This?

This is the backend data pipeline for **GraphCareers** - a platform that maps the Indian tech job market as a graph. It automatically:

- Scrapes thousands of jobs per day from Naukri, Foundit, and Instahyre (Hirist + Internshala ready but inactive)
- Cleans and normalizes raw job data into a consistent schema
- Classifies every job's required skills into technical, tools, and soft skills using curated taxonomy lists (LLM-assisted)
- Uses AI embeddings (OpenRouter + cosine similarity) to assign each job to a canonical role (e.g. "Backend Developer", "Data Engineer")
- Stores the result as a rich property graph in Neo4j: Jobs connected to Roles, Skills, Companies, and Salaries
- Computes live analytics in Neo4j: skill demand rankings, role statistics, company hiring trends
- Runs 3 times daily and sends an email summary report after each cycle

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [How the Pipeline Works](#how-the-pipeline-works)
  - [Scraping](#scraping)
  - [Cleaning and Normalizing](#cleaning-and-normalizing)
  - [Neo4j Ingestion](#neo4j-ingestion)
  - [Post-Processing Analytics](#post-processing-analytics)
  - [Email Reporting](#email-reporting)
- [Project Structure](#project-structure)
- [Data Models](#data-models)
- [Environment Setup](#environment-setup)
- [Running the Application](#running-the-application)
  - [Development](#development)
  - [Production (PM2)](#production-pm2)
- [Scraper Deep Dives](#scraper-deep-dives)
- [Role Classification System](#role-classification-system)
- [Skill Classification System](#skill-classification-system)
- [Queue Architecture (BullMQ)](#queue-architecture-bullmq)
- [Logging and Observability](#logging-and-observability)
- [Maintenance Tasks](#maintenance-tasks)
- [Known Limitations and TODOs](#known-limitations-and-todos)

---

## Architecture Overview

The system is designed as a **distributed, fault-tolerant pipeline** with clear separation of concerns:

```
+------------------------------------------------------------------+
|  CRON SCHEDULER (node-cron in main.js)                          |
|  Fires at 06:00, 13:00, 19:00 IST                               |
|                                                                  |
|  Per-cycle lock via Redis (NX SET with 2-hour TTL)              |
|  Prevents duplicate pipeline runs if a previous cycle runs long |
+------------------------------------------------------------------+
          |
          v
+------------------+   +------------------+   +-------------------+
|  Naukri Scraper  |   | Foundit Scraper  |   | Instahyre Scraper |
|  (BullMQ-based)  |   | (Direct HTTP)    |   | (HTTP + HTML)     |
+------------------+   +------------------+   +-------------------+
          |                     |                      |
          +--------------------+|+---------------------+
                               ||
                               v
                    +----------+----------+
                    |   MongoDB raw_jobs   |
                    |  (staging collection)|
                    +----------+----------+
                               |
                               | (BullMQ: raw-job-queue)
                               v
                   +-----------+-----------+
                   |   Clean Worker(s)     |
                   |   (2 PM2 instances)   |
                   |                       |
                   | Parse + Classify +    |
                   | Role Detection        |
                   +-----------+-----------+
                               |
                               v
                    +----------+----------+
                    |   MongoDB jobs       |
                    |  (normalized data)   |
                    +----------+----------+
                               |
                               v
                   +-----------+-----------+
                   |    Neo4j Ingestion    |
                   |  (Batch MERGE Cypher) |
                   +-----------+-----------+
                               |
                               v
                   +-----------+-----------+
                   |   Post-Processing     |
                   |  (Graph Analytics)    |
                   +-----------+-----------+
                               |
                               v
                   +-----------+-----------+
                   |    Email Report       |
                   |  (Brevo SMTP)         |
                   +-----------------------+
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js (ESM) | 20+ |
| Package Manager | pnpm | 10.19.0 |
| HTTP Client | Axios + axios-retry | ^1.13.4 / ^4.5.0 |
| Browser Automation | Playwright (Chromium) | ^1.58.2 |
| Job Queue | BullMQ | ^5.67.3 |
| Cache / Locks | Redis | ^5.10.0 |
| Primary Database | MongoDB (Mongoose) | ^9.1.6 |
| Graph Database | Neo4j | ^6.0.1 |
| AI / Embeddings | @ai-sdk/openai + ai | ^3.0.26 / ^6.0.78 |
| Cosine Similarity | compute-cosine-similarity | ^1.1.0 |
| Schema Validation | Zod | ^4.3.6 |
| Scheduler | node-cron | ^4.2.1 |
| Email | Nodemailer | ^8.0.4 |
| Proxy Support | https-proxy-agent | ^7.0.6 |
| Logging | Winston + DailyRotate | ^3.19.0 / ^5.0.0 |
| Error Tracking | Sentry Node | ^10.38.0 |
| Process Manager | PM2 | (installed globally) |

---

## How the Pipeline Works

### Scraping

The pipeline runs `runPipeline(cycleLabel)` which sequentially runs configured scrapers, then ingests, post-processes, and emails.

**SCRAPER_CONFIG** determines which scrapers run in each cycle:
- MORNING (00:00-06:00 window): Foundit, Naukri
- AFTERNOON (06:00-13:00 window): Foundit, Naukri
- NIGHT (13:00-19:00 window): Foundit, Naukri, Instahyre

All scrapers share the same contract:
1. Call `connectDB()` to ensure MongoDB is connected
2. Fetch paginated job data from the source API
3. For each new job: save raw JSON to `raw_jobs` collection as `RawJob`
4. Enqueue a message to `raw-job-queue` with the MongoDB `_id`
5. Handle duplicates gracefully (MongoDB 11000 error = skip)
6. Return stats: `{ totalJobs, duplicateJobs, totalErrors }`

**Naukri** is the most complex scraper. Because Naukri's API requires a signed `nkparam` header that can only be obtained from a real browser session, the scraper uses:
- A BullMQ queue (`naukri-http-requests`) to serialize all HTTP requests
- Playwright (Chromium) as a fallback browser to capture the real `nkparam` when a 406 is encountered
- A separate BullMQ queue (`naukri-location-done`) + QueueEvents to signal completion per location
- Homepage cookie fetching that refreshes every 6 minutes

**Foundit** uses the Foundit/Monster API directly with standard HTTP. It paginates until empty response or first duplicate.

**Instahyre** uses the Instahyre jobs API per location. For each job, it fetches the full HTML job detail page to extract experience range via regex (the API does not include this data directly).

### Cleaning and Normalizing

The `cleanworker.js` process (running separately, always-on) consumes `raw-job-queue` jobs:

1. Loads the `RawJob` document from MongoDB
2. Computes a deterministic `_id = SHA256(source + externalId)` to prevent Job duplicates
3. Routes to the source-specific parser via `Cleanerfunction(data, site)`
4. Each parser extracts and normalizes all fields to match the Job schema
5. Saves the normalized Job to the `jobs` collection
6. Marks the `RawJob.status = 'completed'`

Parsers are in `src/cleaner/parsers/` and each is tailored to the API response format of its source.

### Neo4j Ingestion

`runIngestion()` (in `neo4jingest.js`) runs after scraping in each pipeline cycle:

1. Fetches all jobs where `is_ingested = false` in batches of 250
2. For each batch, runs a Cypher `MERGE` transaction that:
   - Creates or updates a `Job` node
   - Creates or updates a `Role` node and links it with `[:MAPS_TO]`
   - Creates or updates a `Company` node and links with `[:POSTED_BY]`
   - Creates or updates `Skill` nodes and links with `[:REQUIRES]`
   - Creates or updates `Tool` nodes and links with `[:USES_TOOL]`
   - Creates or updates a `Salary` node and links with `[:OFFERS_SALARY]`
3. Marks all successfully ingested jobs as `is_ingested = true` in MongoDB

### Post-Processing Analytics

`runPostProcessing()` runs after ingestion. It executes 4 Neo4j Cypher queries:

1. **createRoleSkillLinks**: For each Role, finds the top 20 most common skills across all Jobs that map to that Role, and creates/updates `(Role)-[:REQUIRES]->(Skill)` edges with a `frequency` property.

2. **calculateSkillDemand**: Ranks all Skill nodes by how many active (non-expired) Jobs require them. Sets `demand_rank`, `demand_count`, and `demand_tier` (critical/high/medium/low).

3. **calculateRoleStats**: For each Role, computes average salary min/max and top 10 companies, stored in `RoleStats` nodes.

4. **updateHoursOld**: Updates `hours_old` on all active Job nodes based on `posted_at`.

### Email Reporting

After each pipeline cycle, `sendPipelineReport()` sends an HTML email via Brevo SMTP showing:
- Cycle name (MORNING/AFTERNOON/NIGHT)
- IST timestamp
- Total jobs scraped this cycle
- Per-source job count breakdown

---

## Project Structure

```
jobs-scraping/
+-- src/
|   +-- main.js                    # Cron scheduler + pipeline orchestrator
|   +-- sentry.js                  # Sentry initialization (production only)
|   +-- config/
|   |   +-- redis.js               # Redis client singleton
|   +-- db/
|   |   +-- connection.js          # MongoDB connect (idempotent)
|   |   +-- jobmodel.js            # jobs collection schema
|   |   +-- rawJobmodel.js         # raw_jobs collection schema
|   +-- queue/
|   |   +-- connection.js          # BullMQ connection config
|   |   +-- queue.js               # All queue definitions
|   |   +-- cleanerQueue.js        # Queue obliteration utility
|   |   +-- events.js              # naukri-location-done QueueEvents
|   +-- scrapers/
|   |   +-- naukri/                # BullMQ + Playwright scraper
|   |   +-- foundit/               # Direct HTTP scraper
|   |   +-- instahyre/             # HTTP + HTML detail scraper
|   |   +-- hirist/                # (Implemented, inactive)
|   |   +-- internshala/           # (Implemented, inactive)
|   +-- workers/
|   |   +-- cleanworker.js         # Raw job cleaner/normalizer
|   +-- cleaner/
|   |   +-- index.js               # Parser router
|   |   +-- parsers/               # Source-specific parsers
|   +-- logger/
|   |   +-- logger.js              # Env-appropriate logger export
|   |   +-- dev-logger.js          # Console-only dev logger
|   |   +-- production-logger.js   # File-rotating production logger
|   |   +-- buildScraperLogger.js  # Named logger factory
|   +-- utils/
|       +-- constants.js           # Env vars as named exports
|       +-- ScraperUtilityfunctions.js  # Shared utilities
|       +-- neo4jingest.js         # MongoDB -> Neo4j ingestion
|       +-- postprocessing.js      # Neo4j analytics queries
|       +-- postgressingest.js     # Postgres sync (disabled)
|       +-- getSourceCounts.js     # Source count aggregation
|       +-- sendMail.js            # Pipeline email report
|       +-- daily-job-cleanup.js   # DB cleanup script
|       +-- classifySkillsWithLLM.js  # LLM skill taxonomy tool
|       +-- schema.js              # Zod validation schema
|       +-- sentryContext.js       # Sentry context setter
|       +-- role_master.json       # Role -> skills master map
|       +-- role_vectors_compact.json  # Role embedding vectors
|       +-- technical_skills.json  # Technical skill taxonomy
|       +-- tools_skills.json      # Tools/platform taxonomy
|       +-- soft_skills.json       # Soft skill taxonomy
|       +-- unique_skills.txt      # Unknown skills queue
+-- ecosystem.config.cjs           # PM2 process definitions
+-- package.json
+-- pnpm-lock.yaml
+-- .env.example
+-- eslint.config.js
+-- .prettierrc
+-- commitlint.config.cjs
+-- .husky/
```

---

## Data Models

### MongoDB: raw_jobs collection

Staging area for fresh-scraped data. Jobs are queued here before normalization.

```
{
  rawData: Object,       // Complete raw API response - source varies by portal
  externalId: String,    // Source job ID (unique per source)
  source: String,        // "naukri" | "foundit" | "instahyre" | "hirist" | "internshala"
  status: String,        // "queued" -> "completed" | "failed"
  createdAt: Date,
  updatedAt: Date
}
```

### MongoDB: jobs collection

Normalized, cleaned job data ready for analysis and serving.

```
{
  _id: String,             // sha256(source + externalId) - dedup-safe hash key
  job_id: String,          // Original source ID
  source: String,          // Source portal name
  source_url: String,      // Direct link to job listing
  job_title: String,       // Title as written by employer
  role_title: String,      // Normalized canonical role (from role taxonomy)
  extracted_by: String,    // Role classification method used
  company_name: String,
  skills: {
    technical: [String],   // Programming languages, frameworks, databases
    tools: [String],       // Platforms, cloud services, DevOps tools
    soft: [String]         // Communication, leadership, etc.
  },
  min_experience: Number,  // Years
  max_experience: Number,
  difficulty_level: String,  // "entry" (0-2yr) | "mid" (3-6yr) | "senior" (7+yr)
  salary_min: Number,
  salary_max: Number,
  salary_currency: String,   // Default "INR"
  salary_period: String,     // "year" | "monthly"
  location: String,          // Primary city
  location_state: String,
  location_country: String,
  job_type: String,          // "fulltime" | "parttime" | "contract" | "internship"
  work_mode: String,         // "remote" | "onsite" | "hybrid"
  industry: [String],
  description: String,
  posted_at: Date,
  expiry_at: Date,           // posted_at + 90 days by default
  is_published: Boolean,     // Synced to downstream Postgres backend
  is_ingested: Boolean,      // Ingested into Neo4j
  createdAt: Date,
  updatedAt: Date
}
```

### Neo4j Graph Model

```
Nodes:
  (:Job)       { job_id, title, source, source_url, min/max_experience,
                 location, job_type, work_mode, industry, hours_old,
                 posted_at, expires_at, created_at }

  (:Role)      { role_title, difficulty_level }

  (:Company)   { name }

  (:Skill)     { canonical, demand_rank, demand_count, demand_tier, last_analyzed }

  (:Tool)      { name }

  (:Salary)    { min, max, currency, period }

  (:RoleStats) { role, avgMin, avgMax, topCompanies, updatedAt }

Relationships:
  (Job)-[:MAPS_TO]->(Role)
  (Job)-[:POSTED_BY]->(Company)
  (Job)-[:REQUIRES]->(Skill)
  (Job)-[:USES_TOOL]->(Tool)
  (Job)-[:OFFERS_SALARY]->(Salary)
  (Role)-[:REQUIRES {frequency, last_updated}]->(Skill)
```

---

## Environment Setup

Copy `.env.example` to `.env` and fill in all required values:

```env
# MongoDB
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password

# OpenRouter (for AI role classification via embeddings)
OPENROUTER_API_KEY=sk-or-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1

# Environment
BACKEND_NODE_ENV=production

# Error Tracking (optional, only active in production)
SENTRY_DSN=https://...@sentry.io/...

# HTTP Proxy (optional, recommended for production scraping)
PROXY_SET=true
PROXY_URL=host:port
PROXY_AUTH=user:password

# Email Reports
SMTP_USER=your-brevo-smtp-user
SMTP_PASS=your-brevo-smtp-pass
MY_EMAIL=you@example.com

# Naukri API (optional, used in request headers)
NAUKRI_APP_ID=...
NAUKRI_CLIENT_ID=...
```

---

## Running the Application

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Redis (running locally or remote)
- MongoDB Atlas or local MongoDB instance
- Neo4j (local or AuraDB cloud)

### Development

```bash
# Install dependencies
pnpm install

# Install Playwright browser (required for Naukri scraper)
pnpm exec playwright install chromium

# Run the main scheduler (cron fires at 06:00, 13:00, 19:00 IST)
pnpm dev

# To test a scraper individually, uncomment the self-call at the bottom of the scraper's index.js:
node src/scrapers/foundit/index.js
node src/scrapers/instahyre/index.js
```

### Production (PM2)

The application runs as 4 separate PM2 processes:

| Process | Purpose | Instances |
|---|---|---|
| main-app | Cron pipeline orchestrator | 1 |
| naukri-worker | Naukri BullMQ worker + Playwright | 1 |
| location-done-worker | Naukri location completion signal | 1 |
| cleaner-worker | Raw job cleaner/normalizer | 2 |

```bash
# Install PM2 globally
npm install -g pm2

# Start all processes
pm2 start ecosystem.config.cjs

# Save process list and enable startup
pm2 save
pm2 startup

# Monitor
pm2 monit
pm2 logs
pm2 logs cleaner-worker

# Restart all
pm2 restart all
```

**Note for Linux servers**: The naukri-worker runs Playwright with `headless: false` and uses `xvfb-run` for a virtual display. Ensure `xvfb` is installed: `apt-get install xvfb`.

---

## Scraper Deep Dives

### Naukri Scraper

Naukri's public job search API (`jobapi/v3/search`) requires a `nkparam` header that is a signed, short-lived authentication token generated client-side by their JavaScript. This makes traditional HTTP scraping challenging.

**Solution Architecture:**

```
naukriScraper() [main process]
  |
  +-> For each location in locations.json:
        |
        +-> fetchJobs(location) 
              |
              +-> Enqueue 'fetch' to naukri-http-requests BullMQ queue
              +-> Await QueueEvents 'completed' on naukri-location-done
              |
              | [Waits here until naukriworker signals completion]
              |
        +-> Continue to next location

naukriworker.js [separate PM2 process]
  |
  +-> Consumes from 'naukri-http-requests'
  +-> Makes HTTP GET with cookies + nkparam
  +-> On 406 (nkparam invalid): fetchNkParamFromBrowser()
  |     -> Playwright navigates to Naukri site
  |     -> Intercepts network requests to capture nkparam header
  |     -> Caches nkparam and browser cookies
  +-> On 403 (session blocked): exponential backoff + homepage cookie refresh
  +-> On success: saves jobs to raw_jobs, enqueues to raw-job-queue
  +-> On last page or duplicate streak >= 50: signals to naukri-location-done

locationdoneworker.js [separate PM2 process]
  +-> Consumes from 'naukri-location-done'
  +-> Returns job data (triggers QueueEvents 'completed' event)
```

**Locations**: Configured in `src/scrapers/naukri/data/locations.json`. Includes major Indian cities. Pagination settings (paginationLimit, resultsPerPage) are also in this file.

### Foundit Scraper

Uses the Foundit/Monster India API. Simple paginated HTTP scraping:
- Fetches pages until empty response or first duplicate job
- Max 3 retry attempts per page on error
- Stops immediately on first duplicate (streak >= 1) to avoid re-scraping old data
- Uses shared `axiosInstance` with proxy support (if configured)

### Instahyre Scraper

Instahyre's API (`/api/v2/jobs/`) returns job listings but omits experience range. This scraper:
1. Fetches job listings per location from the API
2. Batch-checks existing `externalId`s in MongoDB to skip already-seen jobs
3. For each new job: fetches the HTML job detail page at `job.public_url`
4. Extracts experience range from HTML using regex (looks for "X-Y years" patterns)
5. Skips the job if experience cannot be determined after 2 attempts
6. Adds experience data to the rawData before saving to MongoDB

---

## Role Classification System

Every job is assigned a `role_title` from a fixed canonical taxonomy. The classification uses a multi-step cascade in `findRole()`:

### Step 1: Title Priority Map
Direct keyword matching against a priority dictionary. Handles high-confidence cases like "data engineer", "devops engineer", "frontend developer". Returns immediately if matched.

### Step 2: Tech Gate
If the job has no recognized hard technical skills AND the title contains no engineering keywords, it falls through directly to O*NET embedding (Step 7). This prevents misclassifying non-tech roles.

### Step 3: Role Scoring Engine
For each role in `role_master.json`, counts how many of the job's technical skills are in that role's skill list.

Score formula: `matched / (matched + 3) + title_boost`

The `+3` denominator prevents short role skill lists from dominating. Title boost adds 0.1 per matching word from the role name found in the job title.

### Step 4: Domain-Specific Strictness
ML/Data Science roles require >= 2 ML core skills. Data Engineering requires >= 2 pipeline/warehouse skills.

### Step 5: Fullstack Correction
If scoring suggests "Frontend Developer" but the job also has backend skills (Java, Python, Node.js, etc.), corrects to "Fullstack Developer".

### Step 6: Low-Confidence Domain Fallback
Jobs with data/ML keywords that didn't score high enough get assigned a known role at reduced confidence.

### Step 7: O*NET Embedding Fallback
For unclear jobs: embeds `"<title>. <skills>"` using OpenRouter's `text-embedding-3-small` model, then finds the closest role from `role_vectors_compact.json` using cosine similarity.

### Step 8: Others
Final fallback if nothing works.

**Key files**:
- `src/utils/role_master.json`: Maps role names to their canonical skill lists
- `src/utils/role_vectors_compact.json`: Pre-computed embeddings for cosine similarity (33MB)

---

## Skill Classification System

Skills are classified into three categories:
- **technical**: Programming languages, frameworks, databases, algorithms, networking
- **tools**: Software tools, platforms, cloud services, DevOps tools, productivity apps
- **soft**: Behavioral skills, communication, leadership, teamwork

**Classification Flow:**

1. Raw skills from API response are extracted as a string/array
2. `filterValidSkills()`: Converts to lowercase and filters against a union of all three JSON lists. Unrecognized skills are appended to `unique_skills.txt` for later review.
3. `classifySkills()`: Puts each valid skill into the appropriate bucket based on which JSON list it appears in.

**JSON Skill Lists** (`technical_skills.json`, `tools_skills.json`, `soft_skills.json`):
These are curated lists of known skills. They need to be updated periodically as new technologies emerge.

**LLM Taxonomy Maintenance** (`src/utils/classifySkillsWithLLM.js`):
A standalone script that reads `unique_skills.txt` (the accumulated unknown skills), sends them to GPT-4o-mini in batches, and classifies each into the three categories. Results update the JSON files.

Run manually when `unique_skills.txt` grows large:
```bash
node src/utils/classifySkillsWithLLM.js
```

---

## Queue Architecture (BullMQ)

All queues use Redis as the backend. Two separate Redis connections exist:
- `src/config/redis.js`: Standard Redis client (for pipeline locks, Internshala date tracking)
- `src/queue/connection.js`: Connection config object used by BullMQ

### Queue Definitions (`src/queue/queue.js`)

| Queue | Retry | Backoff | Purpose |
|---|---|---|---|
| naukri-http-requests | 2 | Exponential 2s | Naukri HTTP fetch jobs |
| raw-job-queue | 2 | Exponential 3s | Job cleaning/normalization |
| naukri-location-done | Default | Default | Location completion signals |
| scraperQueue | 2 | Exponential 1s | Reserved |
| ai-batch-create-queue | 2 | Exponential 3s | Reserved |
| ai-batch-result-queue | 2 | Exponential 3s | Reserved |

All queues: `removeOnComplete: true`, `removeOnFail: false` (failed jobs are retained for inspection).

### Queue Events

`locationDoneEvents` in `src/queue/events.js` is a BullMQ `QueueEvents` instance that listens to the `naukri-location-done` queue. The `fetchJobs.js` for Naukri uses this to await location completion in-process without polling.

---

## Logging and Observability

### Winston Loggers

Two types of loggers:

1. **Global logger** (`src/logger/logger.js`): Used by the pipeline, workers, and utilities. In development: console with colors. In production: daily rotating files (`combined.log`, `error.log`) + console.

2. **Scraper loggers** (`buildScraperLogger(name)`): Named loggers for each scraper, producing separate log files per scraper in `logs/scrapers/<name>/`. Makes debugging specific scraper issues much easier.

All timestamps are in IST (Asia/Kolkata).

### Sentry

Sentry is configured in `src/sentry.js`. It only initializes if both `SENTRY_DSN` is set and `BACKEND_NODE_ENV` is `production` or `prod`. Captures:
- Manually via `Sentry.captureException(err)` in critical catch blocks
- Automatically via `unhandledRejection` and `uncaughtException` process events

Each scraper sets its own Sentry context tag via `setScraperContext(name)` to make filtering in Sentry easier.

---

## Maintenance Tasks

### Daily Cleanup

The `daily-job-cleanup.js` utility deletes completed raw jobs and ingested jobs from MongoDB to keep the database lean. Not scheduled automatically - run manually or add to cron:

```bash
node src/utils/daily-job-cleanup.js
```

Deletes:
- `raw_jobs` where `status = "completed"`
- `jobs` where `is_ingested = true`

### Queue Cleanup

If BullMQ queues accumulate stale jobs (e.g., after a crash), use:

```bash
node src/queue/cleanerQueue.js
```

This obliterates the `raw-job-queue` (waiting, active, completed, failed).

### Skill Taxonomy Update

When `unique_skills.txt` grows large (check size with `wc -l unique_skills.txt`):

```bash
node src/utils/classifySkillsWithLLM.js
```

This reads the file, sends skills to GPT-4o-mini in batches of 300, classifies them, and updates the three JSON taxonomy files.

---

## Known Limitations and TODOs

### Currently Disabled
- **Postgres Sync** (`postgressingest.js`): The code exists to sync normalized jobs to a downstream Postgres backend via REST API. Currently commented out in `main.js`. Re-enable by setting `BACKEND_URL` and uncommenting the Step 3 block.
- **Hirist Scraper**: Implemented but not in `SCRAPER_CONFIG`. Enable by adding to `main.js`.
- **Internshala Scraper**: Implemented with Redis-backed date deduplication, but not in `SCRAPER_CONFIG`. Enable by adding to `main.js`.

### Known Behaviors to Be Aware Of
- **Foundit duplicate threshold**: Currently set to `consecutiveDuplicates >= 0` (i.e., stops on the very first duplicate). This is very aggressive and may miss new jobs if the API returns in non-chronological order. Consider increasing to 5-10.
- **Naukri headless:false**: The Playwright browser launches in visible mode (`headless: false`). On production Linux servers, `xvfb-run` provides the virtual display. Change to `headless: true` if the site behavior changes to allow it.
- **role_vectors_compact.json**: This 33MB file is loaded into memory at worker startup. On memory-constrained systems, this may be a concern.
- **No test suite**: The project currently has no automated tests. Adding unit tests for parsers and integration tests for the pipeline flow would improve reliability.
- **Single Neo4j transaction per batch**: If one job in a 250-job batch fails Neo4j parameter validation, the entire batch is rolled back. Consider per-job transactions for better resilience.
