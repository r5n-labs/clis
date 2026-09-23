import { BaseCommand } from "../base-command";
import { ReportCreateCommand } from "./report/create";
import { ReportBatchCommand, ReportExportCommand, ReportHtmlCommand } from "./report/export";
import { ReportEvidenceCommand, ReportShowCommand } from "./report/inspect";
import { ReportListCommand } from "./report/list";

export class ReportCommand extends BaseCommand {
  name = "report";
  description = "Create and inspect review snapshots";

  init(): void {
    this.registerSubcommands([
      new ReportCreateCommand(),
      new ReportListCommand(),
      new ReportShowCommand(),
      new ReportEvidenceCommand(),
      new ReportBatchCommand(),
      new ReportExportCommand(),
      new ReportHtmlCommand(),
    ]);
  }
}
