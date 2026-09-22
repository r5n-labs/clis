import { args, positionals } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../../base-command";
import { configActions, configArgs, rejectExtraArguments } from "./shared";

const questionArgs = args({
  ...configArgs,
  file: {
    type: "string",
    description: "JSON question file; edit patches fields (minConcernProbability: null disables it)",
  },
});
const addPositionals = positionals({
  group: { description: "Target group, for example methods" },
  extra: { variadic: true },
});
const questionPositionals = positionals({
  group: { description: "Target group, for example methods" },
  id: { description: "Configured question ID" },
  extra: { variadic: true },
});

export class QuestionCommand extends BaseCommand {
  name = "question";
  description = "Add, edit or remove review questions";

  init(): void {
    this.registerSubcommands([new QuestionAddCommand(), new QuestionEditCommand(), new QuestionRemoveCommand()]);
  }
}

class QuestionAddCommand extends BaseCommand {
  name = "add";
  description = "Add a question with guided prompts or --file";
  args = questionArgs;
  positionals = addPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof questionArgs, typeof addPositionals>): Promise<void> {
    rejectExtraArguments(ctx.positionals.extra);
    await configActions(ctx.args, this.args).addQuestion(ctx.positionals.group, ctx.args.file);
  }
}

class QuestionEditCommand extends BaseCommand {
  name = "edit";
  description = "Edit a question with guided prompts or --file";
  args = questionArgs;
  positionals = questionPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof questionArgs, typeof questionPositionals>): Promise<void> {
    rejectExtraArguments(ctx.positionals.extra);
    await configActions(ctx.args, this.args).editQuestion(ctx.positionals.group, ctx.positionals.id, ctx.args.file);
  }
}

class QuestionRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Remove a question while retaining its cached answers";
  args = configArgs;
  positionals = questionPositionals;
  prompts = true;

  async execute(ctx: Ctx<typeof configArgs, typeof questionPositionals>): Promise<void> {
    rejectExtraArguments(ctx.positionals.extra);
    await configActions(ctx.args, this.args).removeQuestion(ctx.positionals.group, ctx.positionals.id);
  }
}
