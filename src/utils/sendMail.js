// utils/sendMail.js
import nodemailer from "nodemailer";
import { MY_EMAIL, SMTP_PASS, SMTP_USER } from "./constants.js";

function formatSourceBreakdown(sourceCounts) {
  return Object.entries(sourceCounts)
    .map(([source, count]) => `• ${source}: <b>${count}</b>`)
    .join("<br>");
}




export async function sendPipelineReport({ cycle, totalJobs, sourceCounts }) {
  const transporter = nodemailer.createTransport({
   host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user:SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const time = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });
  

  const breakdown = formatSourceBreakdown(sourceCounts);

await transporter.sendMail({
      from: "GraphCareers <support@graphcareers.com>", // ✅ FIX
    to: MY_EMAIL,
    subject: `📊 [${cycle}] Job Report`,
    html: `
      <h2>🚀 ${cycle} Pipeline Report</h2>
      <p><b>Time:</b> ${time}</p>

      <h3>Total Jobs: ${totalJobs}</h3>

      <h4>Source Breakdown:</h4>
      <p>${breakdown}</p>
    `
  });
 
}