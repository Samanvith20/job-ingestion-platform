import { connectDB } from "../db/connection.js";
import { Job } from "../db/jobmodel.js";


export async function getSourceCounts({ startTime, endTime }) {
    await connectDB()
  const result = await Job.aggregate([
    {
      $match: {
        createdAt: {
          $gte: startTime,
          $lt: endTime
        }
      }
    },
    {
      $group: {
        _id: "$source",
        count: { $sum: 1 }
      }
    }
  ]);

  // convert to clean object
  const formatted = {};
  result.forEach((item) => {
    formatted[item._id || "unknown"] = item.count;
  });

  return formatted;
}