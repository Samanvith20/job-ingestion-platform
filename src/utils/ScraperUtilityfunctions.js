import axios from "axios";
import logger from "../logger/logger.js";
import { BACKEND_NODE_ENV, OPENAI_BASE_URL, OPENAI_KEY, PROXY_AUTH, PROXY_SET, PROXY_URL } from "./constants.js";
import { HttpsProxyAgent } from 'https-proxy-agent';
import axiosRetry from 'axios-retry';
import fs from "fs";
import { createOpenAI } from "@ai-sdk/openai";
import cosineSimilarity from "compute-cosine-similarity";
import path from "path";
import { fileURLToPath } from "url";
import { embed } from "ai";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



export function randomDelayMs(min = 1500, max = 3500) {
  return Math.round(min + Math.random() * (max - min));
}

export async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
const axiosConfig = {
  timeout: 20000,
  headers: {
    Accept: '*/*',
    Connection: 'keep-alive',

    // User-Agent will be replaced for every request
    'User-Agent': randomUA(),
  },
};

if ((BACKEND_NODE_ENV === 'production' && PROXY_SET === 'true' && PROXY_URL)) {
  try {
    const proxyAuth = PROXY_AUTH ? `${PROXY_AUTH}@` : '';
    const proxyUrl = `http://${proxyAuth}${PROXY_URL}`;

    const agent = new HttpsProxyAgent(proxyUrl, {
      keepAlive: true,
      keepAliveMsecs: 10000,
    });

    axiosConfig.httpAgent = agent;
    axiosConfig.httpsAgent = agent;
    axiosConfig.proxy = false; // IMPORTANT — disable axios default proxy handling

    logger?.info?.(
      `🔗 Using HTTPS proxy: ${PROXY_URL} (auth: ${PROXY_AUTH ? 'enabled' : 'disabled'})`
    );
  } catch (err) {
    logger?.error?.('⚠️ Invalid proxy configuration:', err);
  }
} else {
  logger?.warn?.('🟢 Running without proxy (development mode)');
}

// Export the shared Axios instance
export const axiosInstance = axios.create(axiosConfig);
axiosInstance.interceptors.request.use((config) => {
  config.headers['User-Agent'] = randomUA();
  return config;
});

axiosRetry(axiosInstance, {
  retries: 3, // number of retry attempts
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => {
    // Retry on timeout (ECONNABORTED) or 5xx errors
    return (
      error.code === 'ECONNABORTED' ||
      (error.response?.status >= 500 && error.response?.status < 600)
    );
  },
});



const roleVectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "role_vectors_compact.json"))
);
const roleMaster = JSON.parse(
  fs.readFileSync(path.join(__dirname, "role_master.json"), "utf-8")
);



const technicalList = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, "technical_skills.json")))
);

const toolsList = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, "tools_skills.json")))
);

const softList = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, "soft_skills.json")))
);
const VALID = new Set([
  ...technicalList,
  ...toolsList,
  ...softList,
].map(s => s.toLowerCase().trim()));

export function filterValidSkills(skills) {
  return skills
    .map(s => s.toLowerCase().trim())
    .filter(s => VALID.has(s));
}



export const client = createOpenAI({
  apiKey: OPENAI_KEY,
  baseURL: OPENAI_BASE_URL,
});



export function classifySkills(skillsRaw) {
  const technical = [];
  const tools = [];
  const soft = [];
  const unknown = [];

  for (const s of skillsRaw) {
    const skill = s?.toLowerCase()?.trim();

    if (technicalList.has(skill)) technical.push(s);
    else if (toolsList.has(skill)) tools.push(s);
    else if (softList.has(skill)) soft.push(s);
    else unknown.push(s);
  }

  if (unknown.length) {
    fs.appendFileSync("unknown_skills.txt", unknown.join("\n") + "\n");
  }

  return { technical, tools, soft };
}


// function normalize(s) {
//   if (!s) return '';

//   return s
//     .toLowerCase()
//     .trim()
//     .replace(/\.js$/i, 'js')
//     .replace(/[^a-z0-9+#.]/g, '')
//     .trim();
// }

// function skillsMatch(jobSkill, roleSkill) {
//   const j = normalize(jobSkill);
//   const r = normalize(roleSkill);
  
//   // Exact match
//   if (j === r) return true;
  
//   // One contains the other (react vs reactjs)
//   if (j.includes(r) || r.includes(j)) {
//     // But avoid false positives: "java" shouldn't match "javascript"
//     const minLen = Math.min(j.length, r.length);
//     if (minLen >= 3) return true;
//   }
  
//   // Word-level match (spring boot vs spring)
//   const jWords = j.split(' ');
//   const rWords = r.split(' ');
  
//   if (jWords.length > 1 || rWords.length > 1) {
//     // Check if significant words overlap
//     const overlap = jWords.filter(w => w.length > 2 && rWords.includes(w));
//     if (overlap.length > 0) return true;
//   }
  
//   return false;
// }








// export async function findRole(jobTitle, allSkills) {
//   if (!jobTitle && !allSkills?.length) {
//     return { role: "Others", extracted_by: "no_data" };
//   }

//   const { technical } = classifySkills(allSkills || []);
//   const titleLower = jobTitle.toLowerCase();

//   // 🔐 Strong tech gate
//   const HARD_TECH_SKILLS = new Set([
//     "java","python","javascript","c++","c#","go","ruby",
//     "react","angular","vue","node","node.js",
//     "spring","django","flask",
//     "spark","hadoop","airflow","kafka",
//     "docker","kubernetes","terraform","sql"
//   ]);

//   const strongTechCount = technical.filter(s =>
//     HARD_TECH_SKILLS.has(s.toLowerCase())
//   ).length;

//   if (strongTechCount === 0) {
//     const onet = await getOnetRole(jobTitle, allSkills);
//     return { role: onet || "Others", extracted_by: "onet" };
//   }

//   let bestRole = null;
//   let bestScore = 0;

//   for (const role in roleMaster) {
//     const roleSkills = roleMaster[role].map(s => s.toLowerCase());
//     const matched = roleSkills.filter(s =>
//       technical.includes(s)
//     ).length;

//     if (matched < 2) continue;

//     // ML constraint
//     if (role.includes("Data Scientist") || role.includes("ML")) {
//       const mlCore = roleSkills.filter(s =>
//         ["machine learning","ml","deep learning","tensorflow","pytorch"].includes(s)
//       ).length;
//       if (mlCore === 0) continue;
//     }

//     const coverage = matched / roleSkills.length;

//     let titleBoost = 0;
//     for (const w of role.toLowerCase().split(/[\s/]+/)) {
//       if (w.length > 3 && titleLower.includes(w)) {
//         titleBoost += 0.1;
//       }
//     }

//     const score = coverage + titleBoost;

//     if (score > bestScore) {
//       bestScore = score;
//       bestRole = role;
//     }
//   }

//   if (bestScore >= 0.35) {
//     return { role: bestRole, extracted_by: "skills_and_title" };
//   }

//   if (bestScore >= 0.2) {
//     return { role: bestRole, extracted_by: "skills" };
//   }

//   return { role: "Software Engineer / Developer", extracted_by: "low_confidence" };
// }

export async function findRole(jobTitle, allSkills) {
  if (!jobTitle && !allSkills?.length) {
    return { role: "Others", extracted_by: "no_data" };
  }

  const { technical } = classifySkills(allSkills || []);
  const titleLower = jobTitle?.toLowerCase() || "";
  const techLower = technical.map(s => s.toLowerCase());

  // =====================================================
  // 1. HIGH-CONFIDENCE TITLE MATCH (VERY LIMITED)
  // =====================================================
  const TITLE_PRIORITY = {
    "data engineer": "Data Engineer",
    "business analyst": "Business Analyst",
    "android developer": "Mobile Developer",
    "ios developer": "Mobile Developer",
    "frontend developer": "Frontend Developer",
    "backend developer": "Backend Developer",
    "full stack developer": "Fullstack Developer",
    "fullstack developer": "Fullstack Developer",
    "devops engineer": "DevOps Engineer",
    "qa engineer": "QA / Test Engineer",
    "test engineer": "QA / Test Engineer",
    "database administrator": "Database Engineer / DBA",
    "dba": "Database Engineer / DBA"
  };

  for (const key in TITLE_PRIORITY) {
    if (titleLower.includes(key) && roleMaster[TITLE_PRIORITY[key]]) {
      return { role: TITLE_PRIORITY[key], extracted_by: "title_priority" };
    }
  }

  // =====================================================
  // 2. TECH GATE (DO NOT REMOVE)
  // =====================================================
  const HARD_TECH_SKILLS = new Set([
    "java","python","javascript","typescript","c++","c#","go","ruby","kotlin","swift",
    "react","angular","vue","node","node.js",
    "spring","django","flask","express","hibernate",
    "spark","pyspark","hadoop","airflow","kafka",
    "snowflake","databricks","bigquery","redshift",
    "docker","kubernetes","terraform","ansible","jenkins",
    "sql","postgresql","mysql","mongodb","oracle",
    "aws","azure","gcp","cloud"
  ]);

  const strongTechCount = techLower.filter(s =>
    HARD_TECH_SKILLS.has(s)
  ).length;

  
  // Non-tech job → O*NET
  if (
    strongTechCount === 0 &&
    !titleLower.match(/engineer|developer|analyst|architect|data|software|tech/)
  ) {
    const onet = await getOnetRole(jobTitle, allSkills);
    return { role: onet || "Others", extracted_by: "onet" };
  }

  // =====================================================
  // 3. ROLE SCORING ENGINE (CORE LOGIC)
  // =====================================================
  let bestRole = null;
  let bestScore = 0;

  for (const role in roleMaster) {
    const roleSkills = roleMaster[role].map(s => s.toLowerCase());

    const matched = roleSkills.filter(s =>
      techLower.includes(s)
    ).length;

    if (matched < 2) continue;

    // ---------- ML STRICTNESS ----------
    if (role.includes("Data Scientist") || role.includes("ML")) {
      const mlCoreCount = techLower.filter(s =>
        ["machine learning","ml","deep learning","tensorflow","pytorch","nlp","ai"].includes(s)
      ).length;

      if (mlCoreCount < 2) continue;
    }

    // ---------- DATA ENGINEER STRICTNESS ----------
    if (role === "Data Engineer") {
      const dataCoreCount = techLower.filter(s =>
        ["sql","spark","pyspark","etl","data pipeline","airflow","kafka","snowflake","databricks"].includes(s)
      ).length;

      if (dataCoreCount < 2) continue;
    }

    // ---------- SMART COVERAGE (KEY FIX) ----------
    const coverage = matched / (matched + 3);

    // ---------- TITLE BOOST ----------
    let titleBoost = 0;
    for (const word of role.toLowerCase().split(/[\s/]+/)) {
      if (word.length > 3 && titleLower.includes(word)) {
        titleBoost += 0.1;
      }
    }

    const score = coverage + titleBoost;

    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  // =====================================================
  // 4. FULLSTACK CORRECTION
  // =====================================================
  if (bestRole === "Frontend Developer") {
    const backendIndicators = [
      "java","spring",".net","python","node.js",
      "django","flask","express","hibernate"
    ];

    const hasBackend = techLower.some(s =>
      backendIndicators.includes(s)
    );

    if (hasBackend) {
      bestRole = "Fullstack Developer";
    }
  }

  // =====================================================
  // 5. DATA / ML FALLBACK (CRITICAL FIX)
  // =====================================================
  const dataFallbackCount = techLower.filter(s =>
    ["sql","spark","pyspark","etl","data pipeline","warehouse","airflow","kafka","snowflake"].includes(s)
  ).length;

  const mlFallbackCount = techLower.filter(s =>
    ["machine learning","ml","deep learning","tensorflow","pytorch","nlp","ai"].includes(s)
  ).length;

  if (!bestRole) {
    if (mlFallbackCount > 0) {
      return { role: "Data Scientist / ML Engineer", extracted_by: "low_confidence_ml" };
    }

    if (dataFallbackCount > 0) {
      return { role: "Data Engineer", extracted_by: "low_confidence_data" };
    }
  }

  // =====================================================
  // 6. FINAL RETURN
  // =====================================================
  if (bestScore >= 0.25) {
    return { role: bestRole, extracted_by: "skills_and_title" };
  }

  if (bestScore >= 0.15) {
    return { role: bestRole, extracted_by: "skills" };
  }

  if (strongTechCount > 0) {
    return { role: "Software Engineer / Developer", extracted_by: "low_confidence" };
  }

  const onet = await getOnetRole(jobTitle, allSkills);
  return { role: onet || "Others", extracted_by: "onet" };
}





export async function getOnetRole(title, skills) {
  const text = `${title}. ${skills.join(", ")}`;

  const { embedding: vector } = await embed({
    model: client.embedding("text-embedding-3-small"),
    value: text,
  });

  let best = null;
  let bestScore = -1;

  for (const r of roleVectors) {
    const score = cosineSimilarity(vector, r.vector);
    if (score > bestScore) {
      bestScore = score;
      best = r.role;
    }
  }

  return best;
}



