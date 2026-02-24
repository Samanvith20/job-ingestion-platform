// postProcessingFixed.js
import neo4j from "neo4j-driver";
import { NEO4J_PASSWORD, NEO4J_URI, NEO4J_USER } from "./constants.js";

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
);

async function createRoleSkillLinks() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  
  try {
    console.log('1️⃣ Creating Role-Skill links...');
    
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
    console.log(`✅ Created ${count} Role-Skill links\n`);
    
    return count;
    
  } catch (err) {
    console.error('❌ Failed:', err.message);
    throw err;
  } finally {
    await session.close();
  }
}

async function calculateSkillDemand() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  
  try {
    console.log('2️⃣ Calculating skill demand rankings...');
    
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
    console.log(`✅ Analyzed ${count} skills\n`);
    
    return count;
    
  } catch (err) {
    console.error('❌ Failed:', err.message);
    throw err;
  } finally {
    await session.close();
  }
}

export async function runPostProcessing() {
  console.log("\n🔧 Running Post-Processing...\n");
  console.log("=".repeat(60));
  
  try {
    const roleSkillLinks = await createRoleSkillLinks();
    const skillsAnalyzed = await calculateSkillDemand();
    
    console.log("=".repeat(60));
    console.log("\n✅ POST-PROCESSING COMPLETED!");
    console.log(`   - Role-Skill links: ${roleSkillLinks}`);
    console.log(`   - Skills analyzed: ${skillsAnalyzed}\n`);
    
    // Verify
    const session = driver.session();
    const verifyResult = await session.run(`
      MATCH (r:Role)-[:REQUIRES]->(s:Skill)
      RETURN count(*) AS totalLinks
    `);
    const total = verifyResult.records[0].get('totalLinks').toNumber();
    console.log(`✅ Verification: ${total} total Role-Skill links exist\n`);
    await session.close();
    
  } catch (err) {
    console.error("\n❌ POST-PROCESSING FAILED:", err);
    process.exit(1);
  } finally {
    await driver.close();
    process.exit(0);
  }
}

