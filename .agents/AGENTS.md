# AGENTS.md - AI Agent Guide for jobs-scraping

> **Last Updated:** 2026-06-27
> **Purpose:** This document is the canonical reference for any AI agent working on this codebase. Read it fully before touching any code.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Architecture: How It All Works](#architecture-how-it-all-works)
4. [Directory Structure](#directory-structure)
5. [Pipeline Flow (Step-by-Step)](#pipeline-flow-step-by-step)
6. [Key Modules Reference](#key-modules-reference)
7. [BullMQ Queues Reference](#bullmq-queues-reference)
8. [Data Models](#data-models)
9. [Environment Variables](#environment-variables)
10. [How to Run (PM2 Processes)](#how-to-run-pm2-processes)
11. [Conventions and Rules](#conventions-and-rules)
12. [Common Pitfalls](#common-pitfalls)
13. [Adding a New Scraper](#adding-a-new-scraper)

---

## Project Overview

This is a **Node.js (ESM) job-scraping pipeline** that:

1. Scrapes job listings from multiple Indian job portals (Naukri, Foundit, Instahyre, Hirist, Internshala)
2. Normalizes and cleans the raw data through source-specific parsers
3. Uses AI (OpenAI/OpenRouter embeddings + cosine similarity) to classify job roles
4. Classifies skills into `technical`, `tools`, and `soft` categories using curated JSON lists (with LLM fallback)
5. Ingests processed jobs into **Neo4j** as a knowledge graph (Jobs, Skills, Roles, Companies, Salaries)
6. Runs post-processing in Neo4j to compute Role-Skill relationships, skill demand rankings, and role statistics
7. Sends an email pipeline report after each cycle
8. Is scheduled to run 3 times daily via `node-cron` (06:00, 13:00, 19:00 IST)

The project is deployed using **PM2** with 4 separate processes running concurrently.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ (ESM modules, "type": "module") |
| Package Manager | pnpm (packageManager: pnpm@10.19.0) |
| HTTP | Axios + axios-retry + https-proxy-agent |
| Browser Automation | Playwright (Chromium) - only for Naukri nkparam capture |
| Queue | BullMQ (backed by Redis) |
| Primary DB | MongoDB (Mongoose ODM) |
| Graph DB | Neo4j (neo4j-driver) |
| Caching / Locking | Redis (redis v5 client) |
| AI / Embeddings | OpenAI SDK via @ai-sdk/openai + ai package + compute-cosine-similarity |
| LLM Provider | OpenRouter (OPENAI_BASE_URL + OPENROUTER_API_KEY) |
| Validation | Zod |
| Scheduler | node-cron |
| Logging | Winston + winston-daily-rotate-file |
| Error Tracking | Sentry (@sentry/node) |
| Email | Nodemailer (Brevo SMTP relay) |
| Process Management | PM2 (ecosystem.config.cjs) |
| Linting | ESLint + Prettier |
| Git hooks | Husky + lint-staged + commitlint (conventional commits) |

---

## Architecture: How It All Works

The system runs as a multi-process pipeline:

```
node-cron (main.js) runs 3x daily at 06:00, 13:00, 19:00 IST

Redis Lock (acquireLock) prevents concurrent pipeline runs per cycle

Step 1: SCRAPING
  founditScraper   -> HTTP API (paginated, stops on duplicate streak)
  naukriScraper    -> BullMQ queue + Playwright browser fallback
  instahyreScraper -> HTTP API (per-location, paginated + HTML scrape for experience)
  [hirist / internshala: exist but not in active SCRAPER_CONFIG]

  Each scraper saves raw JSON to MongoDB (raw_jobs collection)
  and enqueues a raw-job task to preprocessQueue (raw-job-queue)

Step 1.5: CLEANING (cleanworker.js - separate PM2 process, 2 cluster instances)
  Dequeues from raw-job-queue
  -> Routes to site-specific parser (cleaner/parsers/)
  -> classifySkills() against JSON skill lists
  -> findRole() using title match + skill scoring + cosine similarity
  -> Saves normalized Job doc to MongoDB (jobs collection)

Step 2: NEO4J INGESTION (neo4jingest.js)
  Fetches jobs where is_ingested=false (batch of 250)
  -> MERGE Cypher: Job -> Role -> Company -> Skill -> Tool -> Salary nodes
  -> Marks is_ingested=true in MongoDB

Step 3: POST-PROCESSING (postprocessing.js)
  createRoleSkillLinks()  -- Role[:REQUIRES]->Skill edges with frequency
  calculateSkillDemand()  -- demand_rank, demand_tier on Skill nodes
  calculateRoleStats()    -- avg salary, top companies on RoleStats nodes
  updateHoursOld()        -- hours_old computed field on Job nodes

Step 4: EMAIL REPORT (sendMail.js)
  getSourceCounts() -> MongoDB aggregate by source for the cycle window
  sendPipelineReport() -> Brevo SMTP email to MY_EMAIL
```

---

## Directory Structure

```
jobs-scraping/
+-- src/
|   +-- main.js                    # Entry point: cron scheduler + pipeline orchestrator
|   +-- sentry.js                  # Sentry error tracking initialization
|   +-- config/
|   |   +-- redis.js               # Redis client (used for distributed locks)
|   +-- db/
|   |   +-- connection.js          # Mongoose connect (idempotent, checks readyState)
|   |   +-- jobmodel.js            # Mongoose schema: jobs collection (normalized)
|   |   +-- rawJobmodel.js         # Mongoose schema: raw_jobs collection (staging)
|   +-- queue/
|   |   +-- connection.js          # BullMQ Redis connection config
|   |   +-- queue.js               # All BullMQ queue definitions
|   |   +-- cleanerQueue.js        # Utility: obliterate the raw-job-queue
|   |   +-- events.js              # QueueEvents for naukri-location-done
|   +-- scrapers/
|   |   +-- naukri/
|   |   |   +-- index.js           # naukriScraper() orchestrator
|   |   |   +-- naukrilogger.js    # Winston logger for naukri
|   |   |   +-- data/
|   |   |   |   +-- locations.json # City list + pagination config
|   |   |   |   +-- constants.js   # HEADERS, SOURCE, page settings
|   |   |   +-- functions/
|   |   |   |   +-- fetchJobs.js   # Enqueues first page, waits for locationDone event
|   |   |   +-- workers/
|   |   |       +-- naukriworker.js        # BullMQ worker: HTTP fetch + Playwright fallback
|   |   |       +-- locationdoneworker.js  # BullMQ worker: signals location completion
|   |   +-- foundit/
|   |   |   +-- index.js
|   |   |   +-- founditlogger.js
|   |   |   +-- data/constants.js
|   |   |   +-- functions/fetchJobs.js
|   |   +-- instahyre/
|   |   |   +-- index.js
|   |   |   +-- instahyrelogger.js
|   |   |   +-- data/constants.js
|   |   |   +-- functions/fetchJobs.js
|   |   +-- hirist/                # Partial - not in active SCRAPER_CONFIG
|   |   +-- internshala/           # Partial - not in active SCRAPER_CONFIG
|   +-- workers/
|   |   +-- cleanworker.js         # BullMQ worker: dequeue -> clean -> save to jobs
|   +-- cleaner/
|   |   +-- index.js               # Cleanerfunction() routes to source-specific parser
|   |   +-- parsers/
|   |       +-- naukriparser.js
|   |       +-- founditparser.js
|   |       +-- instahyreparser.js
|   |       +-- hirisitparser.js
|   |       +-- internshalaparser.js
|   |       +-- internshalaInternshipParser.js
|   +-- logger/
|   |   +-- logger.js              # Exports env-appropriate logger
|   |   +-- dev-logger.js
|   |   +-- production-logger.js
|   |   +-- buildScraperLogger.js  # Factory for named per-scraper loggers
|   +-- utils/
|       +-- constants.js           # All env vars exported as named constants
|       +-- ScraperUtilityfunctions.js   # axiosInstance, delay, classifySkills, findRole
|       +-- neo4jingest.js         # runIngestion(): MongoDB to Neo4j batch upsert
|       +-- postprocessing.js      # runPostProcessing(): Neo4j graph analytics
|       +-- postgressingest.js     # syncMongoJobsToPostgres() (currently disabled)
|       +-- getSourceCounts.js     # MongoDB aggregate: job count by source
|       +-- sendMail.js            # sendPipelineReport() via Brevo SMTP
|       +-- daily-job-cleanup.js   # runCleanup(): deletes completed raw jobs
|       +-- classifySkillsWithLLM.js  # LLM-based skill classifier (standalone script)
|       +-- schema.js              # Zod schema for LLM skill classification
|       +-- sentryContext.js       # setScraperContext() helper
|       +-- role_master.json       # role -> required skills map (for scoring)
|       +-- role_vectors_compact.json  # Pre-computed role embeddings (33MB)
|       +-- technical_skills.json  # Curated technical skills list
|       +-- tools_skills.json      # Curated tool skills list
|       +-- soft_skills.json       # Curated soft skills list
|       +-- unique_skills.txt      # Auto-appended unknown skills log
+-- ecosystem.config.cjs           # PM2 process config (4 processes)
+-- package.json
+-- pnpm-lock.yaml
+-- .env                           # Secret env vars (never commit)
+-- .env.example                   # Template for required env vars
+-- eslint.config.js
+-- .prettierrc
+-- commitlint.config.cjs
+-- .husky/                        # Git hooks: pre-commit (lint+format), commit-msg
```

---

## Pipeline Flow (Step-by-Step)

### How naukriScraper works (most complex)

Naukri uses a BullMQ-based approach because it requires cookie management, a nkparam header from a real browser session, and pagination-aware retries.

1. naukriScraper() reads locations.json and for each location calls fetchJobs(location, ...)
2. fetchJobs() builds the search URL and enqueues a fetch job into naukriQueue (BullMQ)
3. It then awaits a QueueEvents completed event on naukri-location-done queue for that specific location
4. naukriworker.js (a separate PM2 process) dequeues from naukri-http-requests and:
   - Makes an HTTP GET to the Naukri API with cookies + nkparam header
   - On 406: triggers fetchNkParamFromBrowser(location) which uses Playwright to capture a real nkparam, then re-enqueues the same page with the refreshed token (up to 3 times)
   - On 403: exponential backoff + cookie refresh from homepage (up to 4 times)
   - On CAPTCHA: retries up to 4 times with delay
   - On success: saves each jobDetails[] item to RawJob and enqueues to preprocessQueue
   - When the last page is done OR consecutive duplicates >= 50: enqueues a done signal to locationDoneQueue
5. locationdoneworker.js consumes naukri-location-done and returns job.data, which fires the QueueEvents completed event and resolves the promise in step 3

### How founditScraper works

- Direct HTTP pagination (no BullMQ for the scrape itself)
- Stops immediately on the first duplicate (streak >= 1, may need tuning)
- Saves to RawJob and enqueues to preprocessQueue

### How instahyreScraper works

- HTTP API per location (from LOCATIONS constant array)
- For each new job: fetches the HTML detail page to extract experience via regex
- Validates HTML quality before extracting (checks for "years", "Instahyre", min 5000 chars)
- Saves to RawJob and enqueues to preprocessQueue

### How cleanworker.js works

Always running as a separate PM2 process (2 cluster instances):

1. Dequeues from raw-job-queue
2. Fetches the RawJob doc from MongoDB by the ID in the queue message
3. Generates _id = sha256(source + externalId) for deterministic dedup
4. Calls Cleanerfunction(rawData, source) which routes to the correct parser
5. Each parser filters skills, classifies them (technical/tools/soft), calls findRole()
6. Saves normalized Job to jobs collection, updates RawJob.status = 'completed'

### Role Detection (findRole) Logic

The findRole() function in ScraperUtilityfunctions.js uses a multi-step cascade:

1. Title Priority Match - direct string match against a priority map (e.g. "data engineer" -> Data Engineer)
2. Tech Gate - if no hard tech skills AND title has no tech keywords: fall through to O*NET embedding
3. Role Scoring Engine - score = matched_skills / (matched + 3) + title_boost (0.1 per matching word)
4. ML/Data Engineer Strictness - requires >= 2 ML core or data pipeline skills
5. Fullstack Correction - if Frontend is best match but has backend skills, correct to Fullstack
6. Data/ML Fallback - low-confidence: assign Data Engineer or Data Scientist/ML Engineer
7. O*NET Embedding - embed (title + skills) text, cosine similarity against role_vectors_compact.json
8. Others - fallback if nothing matches

---

## Key Modules Reference

| File | Export | Description |
|---|---|---|
| src/main.js | (none) | Cron scheduler, runPipeline(), Redis lock management |
| src/db/connection.js | connectDB() | Idempotent MongoDB connect |
| src/db/jobmodel.js | Job | Mongoose model for normalized jobs |
| src/db/rawJobmodel.js | RawJob | Mongoose model for raw scraped data |
| src/queue/queue.js | naukriQueue, preprocessQueue, etc. | BullMQ queue instances |
| src/queue/events.js | locationDoneEvents | QueueEvents for location-done signaling |
| src/cleaner/index.js | Cleanerfunction(data, site) | Routes raw data to site-specific parser |
| src/utils/ScraperUtilityfunctions.js | axiosInstance, delay, randomDelayMs, classifySkills, filterValidSkills, findRole, parsePostedDate, getOnetRole | Core shared utilities |
| src/utils/neo4jingest.js | runIngestion() | Batch upserts jobs into Neo4j graph |
| src/utils/postprocessing.js | runPostProcessing() | Neo4j analytics pass |
| src/utils/sendMail.js | sendPipelineReport() | Email report via Brevo SMTP |
| src/utils/getSourceCounts.js | getSourceCounts() | MongoDB aggregate for email report |
| src/utils/daily-job-cleanup.js | runCleanup() | Deletes completed raw_jobs |
| src/logger/buildScraperLogger.js | buildScraperLogger(name) | Creates named Winston logger |
| src/sentry.js | Sentry (default export) | Pre-initialized Sentry instance |

---

## BullMQ Queues Reference

| Queue Name | Purpose | Producer | Consumer |
|---|---|---|---|
| naukri-http-requests | Paginated Naukri HTTP fetch tasks | fetchJobs.js (naukri) | naukriworker.js |
| raw-job-queue | Clean-and-save tasks for all sources | All scrapers fetchJobs.js files | cleanworker.js |
| naukri-location-done | Signal: a location's scraping is complete | naukriworker.js | locationdoneworker.js |
| scraperQueue | Reserved, not actively used | - | - |
| ai-batch-create-queue | Reserved for future AI batch processing | - | - |
| ai-batch-result-queue | Reserved for future AI batch results | - | - |

---

## Data Models

### RawJob (raw_jobs collection)

- rawData: Mixed - Raw API response from the source
- externalId: String (unique index) - Source-specific job ID
- source: String - naukri, foundit, instahyre, hirist, or internshala
- status: String - queued, completed, or failed
- createdAt, updatedAt: Date

### Job (jobs collection)

- _id: String - sha256(source + externalId), deterministic dedup key
- job_id: String - Original external ID from source
- source, source_url: String
- job_title: String - As received from source
- role_title: String - Normalized canonical role (e.g. Backend Developer)
- company_name: String
- skills.technical: [String] - e.g. ["python", "sql"]
- skills.tools: [String] - e.g. ["docker", "kubernetes"]
- skills.soft: [String] - e.g. ["communication"]
- min_experience, max_experience: Number
- difficulty_level: String - entry (0-2 yrs), mid (3-6 yrs), or senior (7+ yrs)
- salary_min, salary_max: Number
- salary_currency: String (default INR)
- salary_period: String - year or monthly
- location, location_state, location_country: String
- job_type: String - fulltime, parttime, contract, or internship
- work_mode: String - remote, onsite, or hybrid
- industry: [String]
- description: String
- extracted_by: String - method used for role detection
- posted_at, expiry_at: Date
- is_published: Boolean - true = synced to Postgres backend
- is_ingested: Boolean - true = ingested into Neo4j
- createdAt, updatedAt: Date (from Mongoose timestamps)

### Neo4j Graph Model

Nodes: Job, Role, Company, Skill, Tool, Salary, RoleStats

Relationships:
- (Job)-[:MAPS_TO]->(Role)
- (Job)-[:POSTED_BY]->(Company)
- (Job)-[:REQUIRES]->(Skill)
- (Job)-[:USES_TOOL]->(Tool)
- (Job)-[:OFFERS_SALARY]->(Salary)
- (Role)-[:REQUIRES]->(Skill) with frequency property, created by post-processing

Computed properties added by post-processing:
- Skill: demand_rank, demand_count, demand_tier (critical/high/medium/low), last_analyzed
- Job: hours_old
- RoleStats: avgMin, avgMax, topCompanies, updatedAt

---

## Environment Variables

All env vars are loaded in src/utils/constants.js via dotenv from the project root .env file.

| Variable | Required | Description |
|---|---|---|
| MONGO_URI | Yes | MongoDB connection string |
| REDIS_HOST | Yes | Redis host (default: localhost) |
| REDIS_PORT | Yes | Redis port (default: 6379) |
| NEO4J_URI | Yes | Neo4j bolt URI (e.g. bolt://localhost:7687) |
| NEO4J_USERNAME | Yes | Neo4j username |
| NEO4J_PASSWORD | Yes | Neo4j password |
| OPENROUTER_API_KEY | Yes | OpenRouter API key (used as OPENAI_KEY internally) |
| OPENAI_BASE_URL | Yes | OpenRouter base URL (https://openrouter.ai/api/v1) |
| BACKEND_NODE_ENV | Yes | production or development |
| SENTRY_DSN | Optional | Sentry DSN for error tracking (only active in production) |
| PROXY_SET | Optional | "true" to enable HTTP proxy |
| PROXY_URL | Optional | Proxy host:port |
| PROXY_AUTH | Optional | Proxy user:password |
| SMTP_USER | Yes | Brevo SMTP user for email reports |
| SMTP_PASS | Yes | Brevo SMTP password |
| MY_EMAIL | Yes | Recipient email for pipeline reports |
| BACKEND_URL | Optional | Backend API URL for Postgres sync (currently disabled in pipeline) |
| NAUKRI_APP_ID | Optional | Naukri API app ID (used in request headers) |
| NAUKRI_CLIENT_ID | Optional | Naukri API client ID (used in request headers) |

---

## How to Run (PM2 Processes)

The project runs as 4 separate PM2 processes defined in ecosystem.config.cjs:

| PM2 App Name | Script | Instances | Mode | Notes |
|---|---|---|---|---|
| main-app | src/main.js | 1 | fork | Cron scheduler + pipeline orchestrator |
| naukri-worker | src/scrapers/naukri/workers/naukriworker.js | 1 | fork | Runs under xvfb-run on Linux for headless Playwright |
| location-done-worker | src/scrapers/naukri/workers/locationdoneworker.js | 1 | fork | Signals naukri location completion |
| cleaner-worker | src/workers/cleanworker.js | 2 | cluster | Cleans and normalizes raw job data |

Commands:
```bash
# Install dependencies
pnpm install

# Install Playwright browser
pnpm exec playwright install chromium

# Start all processes
pm2 start ecosystem.config.cjs

# View logs
pm2 logs

# Restart specific process
pm2 restart naukri-worker

# Development (single process, no PM2)
pnpm dev
```

---

## Conventions and Rules

### Code Style
- ESM only - always use import/export, never require()
- No TypeScript - plain JavaScript, no type annotations
- Prettier auto-formats on pre-commit (via Husky + lint-staged)
- ESLint enforces code quality - run pnpm lint before pushing
- Conventional commits enforced by commitlint: feat:, fix:, chore:, refactor:, etc.

### Error Handling
- Scrapers must never crash the overall pipeline - all scraper errors are caught and logged
- Workers re-throw errors so BullMQ can mark jobs as failed and retry (up to 2 attempts per queue definition)
- Always call Sentry.captureException(err) in catch blocks for critical paths
- Use logger.error() not console.error() everywhere

### Logging
- Use the default logger from src/logger/logger.js for global/pipeline logs
- Use buildScraperLogger(scraperName) to create named per-scraper loggers
- Log levels: debug (dev only), info, warn, error
- In production: logs rotate daily, kept for 14 days, max 20MB per file
- IST timezone is used for all log timestamps

### Deduplication Strategy
- Raw jobs: deduplicated by externalId (MongoDB unique index, duplicate -> error code 11000)
- Cleaned jobs: deduplicated by _id = sha256(source + externalId) in cleanworker.js
- Naukri: stops pagination when consecutive duplicate streak >= 50
- Foundit: stops immediately on first duplicate (streak >= 1)
- Internshala: uses Redis to track last-scraped date and only processes newer jobs

### Redis Usage
- src/config/redis.js: main Redis client using redis v5 (for pipeline locks, Internshala date tracking)
- src/queue/connection.js: plain object with host/port for BullMQ (not the Redis client)
- These are two separate Redis connections and must not be mixed

---

## Common Pitfalls

1. role_vectors_compact.json is 33MB - do not edit by hand. It contains pre-computed embeddings. Regenerate it using the embedding utility if role taxonomy changes.

2. unique_skills.txt grows over time - intentional. It logs skills not found in any curated list. Run classifySkillsWithLLM.js periodically to categorize new skills and update the JSON lists.

3. Naukri nkparam is a signed token that expires. 406 responses trigger the Playwright browser fallback automatically in naukriworker.js. If seeing persistent 406s, the browser launch may be failing.

4. BullMQ and Redis must be running before pnpm dev or PM2 start. The app calls process.exit(1) on Redis connection failure.

5. MongoDB bufferCommands: false means Mongoose operations throw immediately if disconnected. Always call connectDB() before any DB operations.

6. PM2 cluster mode for cleaner-worker means 2 Node.js processes share the queue. Do not add shared in-memory state between worker invocations.

7. Postgres sync (postgressingest.js) is currently commented out in main.js. The code exists and is ready but requires a running backend with the /api/jobs/ingest endpoint.

8. Hirist and Internshala scrapers exist but are not in the active SCRAPER_CONFIG in main.js. To enable: add them to the MORNING/AFTERNOON/NIGHT arrays and add them to the SCRAPERS object.

9. NAUKRI_WORKER is just a string constant used as a Sentry context identifier, not a runtime config flag.

10. scraperQueue, aiBatchQueue, aiBatchResultQueue queues are defined in queue.js but no workers consume them currently. They are reserved for planned AI batch features.

11. The naukri-worker PM2 process on Linux uses xvfb-run for virtual display (Playwright needs a display). On macOS/Windows with headless:false, this needs adjustment.

12. Job expiry is set to 21 days (JOB_EXPIRY_DAYS constant) in Neo4j. Post-processing queries use expires_at > datetime() to filter active jobs.

---

## Adding a New Scraper

Follow this exact checklist when adding a new job portal:

### Step 1: Create the scraper directory
```
src/scrapers/<portal>/
```

### Step 2: Create required files

**index.js** - main entry point
```js
import Sentry from '../../sentry.js';
import { setScraperContext } from '../../utils/sentryContext.js';
import { fetchJobs } from './functions/fetchJobs.js';
import portalLogger from './<portal>logger.js';

export async function <portal>Scraper() {
  setScraperContext('<portal>');
  try {
    const { totalJobs, duplicateJobs } = await fetchJobs();
    portalLogger.info(`Done. Total: ${totalJobs}, Duplicates: ${duplicateJobs}`);
  } catch (error) {
    Sentry.captureException(error);
    portalLogger.error(`Error: ${error.message}`);
  }
}
```

**<portal>logger.js**
```js
import { buildScraperLogger } from '../../logger/buildScraperLogger.js';
export default buildScraperLogger('<portal>');
```

**data/constants.js** - BASE_URL, PAGE_LIMIT, SOURCE constant, etc.

**functions/fetchJobs.js** - Must:
- Call connectDB() at the top
- Save each job: await RawJob.create({ rawData, externalId, source: '<portal>', status: 'queued' })
- Enqueue: await preprocessQueue.add('raw-job', { id: doc._id })
- Handle MongoDB 11000 duplicate errors gracefully (catch and count, continue)
- Return { totalJobs, duplicateJobs, totalErrors }

### Step 3: Create parser

**src/cleaner/parsers/<portal>parser.js**
```js
import { classifySkills, filterValidSkills, findRole, parsePostedDate } from '../../utils/ScraperUtilityfunctions.js';

export default async function <portal>Parser(rawJob) {
  const validSkills = filterValidSkills(/* extract skills */);
  const skills = classifySkills(validSkills);
  const role_title = await findRole(rawJob.title, validSkills);
  // ... parse all fields
  return {
    job_id, source: '<portal>', source_url, job_title, role_title: role_title.role,
    extracted_by: role_title.extracted_by, company_name, skills,
    min_experience, max_experience, difficulty_level,
    salary_min, salary_max, salary_currency, salary_period,
    location, location_country, industry, description, job_type, work_mode,
    posted_at, expiry_at
  };
}
```

### Step 4: Register the parser in src/cleaner/index.js
Add a new case to the switch statement in Cleanerfunction().

### Step 5: Register the scraper in src/main.js
Add to the SCRAPERS object and to the appropriate cycle arrays in SCRAPER_CONFIG.

### Step 6: Test individually
Temporarily uncomment the self-call at the bottom of index.js and run:
```bash
node src/scrapers/<portal>/index.js
```
