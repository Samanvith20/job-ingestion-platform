import { connectDB } from "./connection.js";
import { Job } from "./jobmodel.js";
import { RawJob } from "./rawJobmodel.js";


async function run() {
  await connectDB();
  

  // const res = await RawJob.deleteMany(
  //   { status: "completed" }
  // );
  const count=await Job.countDocuments({is_ingested:true});
  console.log(`📊 ${count} uningested jobs`);

  //console.log(`🔁 Deleted ${res.deletedCount} completed jobs`);

  process.exit(0);
}

run();
