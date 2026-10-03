import { Exit, log, positionals, select } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { PresetCommand } from "./preset";
import { requireTerminal } from "./prompt-values";
import { QuestionCommand } from "./question";
import { configActions, configArgs, rejectExtraArguments } from "./shared";

const noPositionals = positionals({ extra: { variadic: true } });
const setPositionals = positionals({
  key: { description: "root, model, include, exclude, maxQuestions or maxRequestBytes" },
  value: { description: "New value; include/exclude take a quoted JSON array" },
  extra: { variadic: true },
});

export class ConfigCommand extends BaseCommand {
  name = "config";
  description = "Manage project settings, presets and questions";
  args = configArgs;
  positionals = noPositionals;
  prompts = true;

  init(): void {
    this.registerSubcommands([
      new ConfigShowCommand(),
      new PresetCommand(),
      new QuestionCommand(),
      new ConfigSetCommand(),
    ]);
  }

  async execute(ctx: Ctx<typeof configArgs, typeof noPositionals>): Promise<void> {
    rejectExtraArguments(ctx.positionals.extra);
    configActions(ctx.args, this.args);
    requireTerminal();
    while (true) {
      const action = await select({
        message: "Argus configuration",
        options: [
          { label: "Show configuration", value: "show" },
          { label: "Add presets", value: "preset" },
          { label: "Add question", value: "add" },
          { label: "Edit question", value: "edit" },
          { label: "Remove question", value: "remove" },
          { label: "Edit settings", value: "set" },
          { label: "Done", value: "done" },
        ],
      });
      if (action === "done") return;
      try {
        const actions = configActions(ctx.args, this.args);
        switch (action) {
          case "show":
            actions.show();
            break;
          case "preset":
            await actions.addPresets();
            break;
          case "add":
            await actions.addQuestion();
            break;
          case "edit":
            await actions.editQuestion();
            break;
          case "remove":
            await actions.removeQuestion();
            break;
          case "set":
            await actions.set();
            break;
        }
      } catch (error) {
        if (!(error instanceof Exit)) throw error;
        log.warn(error.message);
        if (error.hint) log.info(error.hint);
      }
    }
  }
}

class ConfigShowCommand extends BaseCommand {
  name = "show";
  description = "Print the effective configuration as JSON";
  args = configArgs;
  positionals = noPositionals;

  async execute(ctx: Ctx<typeof configArgs, typeof noPositionals>): Promise<void> {
    rejectExtraArguments(ctx.positionals.extra);
    configActions(ctx.args, this.args).show();
  }
}

class ConfigSetCommand extends BaseCommand {
  name = "set";
  description = "Edit a project setting";
  args = configArgs;
  positionals = setPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof configArgs, typeof setPositionals>): Promise<void> {
    rejectExtraArguments(ctx.positionals.extra);
    await configActions(ctx.args, this.args).set(ctx.positionals.key, ctx.positionals.value);
  }
}
