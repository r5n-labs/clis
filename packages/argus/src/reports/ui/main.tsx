import { createRoot } from "react-dom/client";
import type { Report } from "../report-data";
import { ReportApp } from "./ReportApp";

const root = document.getElementById("root");
const data = document.getElementById("argus-report-data");
if (!root || !data?.textContent) throw new Error("Argus report data is missing");
const report: Report = JSON.parse(data.textContent);
createRoot(root).render(<ReportApp report={report} />);
