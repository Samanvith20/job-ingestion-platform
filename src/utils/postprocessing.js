// postProcessingFixed.js
import neo4j from "neo4j-driver";
import { NEO4J_PASSWORD, NEO4J_URI, NEO4J_USER } from "./constants.js";
import logger from "../logger/logger.js";

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
);

async function createRoleSkillLinks() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  
  try {
    logger.info('1️⃣ Creating Role-Skill links...');
    
    const result = await session.run(`
      MATCH (j:Job)-[:MAPS_TO]->(r:Role)
      MATCH (j)-[:REQUIRES]->(s:Skill)
      
      WITH r, s, count(j) AS frequency
      ORDER BY r.role_title, r.difficulty_level, frequency DESC
      
      WITH r, collect({skill: s, freq: frequency})[0..20] AS topSkills
      
      UNWIND topSkills AS skillData
      
      WITH r, skillData.skill AS skill, skillData.freq AS freq
      
      MERGE (r)-[rel:REQUIRES]->(skill)
      SET rel.frequency = freq,
          rel.last_updated = datetime()
      
      RETURN count(DISTINCT rel) AS linksCreated
    `);
    
    const count = result.records[0].get('linksCreated').toNumber();
    logger.info(`✅ Created ${count} Role-Skill links\n`);
    
    return count;
    
  } catch (err) {
    logger.error('❌ Role-Skill links failed: %s', err.message);
    throw err;
  } finally {
    await session.close();
  }
}
async function calculateRoleStats() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });

  try {
    logger.info('3️⃣ Calculating RoleStats...');

    const result = await session.run(`
      MATCH (j:Job)-[:MAPS_TO]->(r:Role)
      OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
      OPTIONAL MATCH (j)-[:OFFERS_SALARY]->(sal:Salary)
      WHERE j.expires_at > datetime()

      WITH r,
           avg(sal.min) AS avgMin,
           avg(sal.max) AS avgMax,
           collect(DISTINCT c.name)[0..10] AS topCompanies

      MERGE (rs:RoleStats {role: r.role_title})
      SET rs.avgMin = avgMin,
          rs.avgMax = avgMax,
          rs.topCompanies = topCompanies,
          rs.updatedAt = datetime()

      RETURN count(rs) AS rolesUpdated
    `);

    const count = result.records[0].get('rolesUpdated').toNumber();
    logger.info(`✅ Updated ${count} RoleStats\n`);

    return count;

  } catch (err) {
    logger.error('❌ RoleStats failed: %s', err.message);
    throw err;
  } finally {
    await session.close();
  }
}

async function calculateSkillDemand() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  
  try {
    logger.info('2️⃣ Calculating skill demand rankings...');
    
    const result = await session.run(`
      MATCH (s:Skill)<-[:REQUIRES]-(j:Job)
      WHERE j.expires_at > datetime()
      
      WITH s, count(j) AS jobCount
      ORDER BY jobCount DESC
      
      WITH collect({skill: s, count: jobCount}) AS allSkills
      
      UNWIND range(0, size(allSkills) - 1) AS idx
      
      WITH allSkills[idx].skill AS skill, 
           allSkills[idx].count AS jobCount,
           idx
      
      SET skill.demand_rank = idx + 1,
          skill.demand_count = jobCount,
          skill.demand_tier = 
            CASE 
              WHEN idx < 20 THEN "critical"
              WHEN idx < 50 THEN "high"
              WHEN idx < 100 THEN "medium"
              ELSE "low"
            END,
          skill.last_analyzed = datetime()
      
      RETURN count(*) AS skillsAnalyzed
    `);
    
    const count = result.records[0].get('skillsAnalyzed').toNumber();
    logger.info(`✅ Analyzed ${count} skills\n`);
    
    return count;
    
  } catch (err) {
    logger.error('❌ Skill demand calculation failed: %s', err.message);
    throw err;
  } finally {
    await session.close();
  }
}
async function updateHoursOld() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  
  try {
    logger.info('3️⃣ Updating hours_old on all active jobs...');
    
    const result = await session.run(`
      MATCH (j:Job)
      WHERE j.posted_at IS NOT NULL
        AND j.expires_at > datetime()
      SET j.hours_old = duration.between(datetime(j.posted_at), datetime()).hours
      RETURN count(j) AS updated
    `);
    
    const count = result.records[0].get('updated').toNumber();
    logger.info(`✅ Updated hours_old on ${count} active jobs\n`);
    
    return count;
    
  } catch (err) {
    logger.error('❌ Updating hours_old failed: %s', err.message);
    throw err;
  } finally {
    await session.close();
  }
}

export async function runPostProcessing() {
logger.info("\n🔧 Running Post-Processing...\n");
logger.info("=".repeat(60));
  
  try {
    const roleSkillLinks = await createRoleSkillLinks();
    const skillsAnalyzed = await calculateSkillDemand();
    const roleStats      = await calculateRoleStats(); // ✅ NEW
    const hoursOldUpdated = await updateHoursOld();

    logger.info("=".repeat(60));
     logger.info("\n✅ POST-PROCESSING COMPLETED!");
     logger.info(`   - Role-Skill links: ${roleSkillLinks}`);
     logger.info(`   - Skills analyzed: ${skillsAnalyzed}`);
     logger.info(`   - RoleStats updated: ${roleStats}\n`);
         logger.info(`   - hours_old updated: ${hoursOldUpdated}\n`); // ← and this
    
    const session = driver.session();
    const verifyResult = await session.run(`
      MATCH (r:Role)-[:REQUIRES]->(s:Skill)
      RETURN count(*) AS totalLinks
    `);

    const total = verifyResult.records[0].get('totalLinks').toNumber();
     logger.info(`✅ Verification: ${total} total Role-Skill links exist\n`);
    
    await session.close();
    
  } catch (err) {
    logger.error("❌ POST-PROCESSING FAILED:", err);
    throw err;
  }
}

// Graceful shutdown — close the driver only when the process exits.
// Do NOT call driver.close() inside runPostProcessing() because this module's
// driver is a singleton and closing it permanently destroys the pool.
process.once('SIGTERM', () => driver.close());
process.once('SIGINT',  () => driver.close());

