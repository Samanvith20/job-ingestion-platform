import mongoose from "mongoose";
import logger from "../logger/logger.js";

mongoose.set("bufferCommands", false);

export async function connectDB() {
  try {
    if (mongoose.connection.readyState === 1) {
      return;
    }

    mongoose.connection.on("connected", () => {
      logger.info("MongoDB connected");
    });

    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
    });

    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });
  } catch (err) {
    logger.error("MongoDB connection failed:", err);
  }
}