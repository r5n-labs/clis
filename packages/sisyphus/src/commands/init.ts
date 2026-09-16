import { args, Cancel, color, confirm, deepMerge, group, note, text } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import { CLI_BIN, SISYPHUS_DEFAULT_CONFIG } from "../constants";
import type { DeepPartial, SisyphusConfig } from "../types";

const initArgs = args({
  changelog: { description: "Generate changelog for releases", type: "boolean" },
  commitAuthor: { description: "Commit author name", type: "string" },
  commitEmail: { description: "Commit author email", type: "string" },
  commitMessage: { description: "Commit message template", type: "string" },
  createRelease: { description: "Create a release on git provider", type: "boolean" },
  default: { alias: "d", default: false, description: "Reset to default config", type: "boolean" },
  force: { alias: "f", default: false, description: "Overwrite existing config", type: "boolean" },
  npm: { description: "Publish to NPM on release", type: "boolean" },
  push: { description: "Push commits and tags to remote on release", type: "boolean" },
  rootChangelog: { description: "Generate combined changelog for monorepo", type: "boolean" },
  single: { alias: "s", description: "Setup for single package (not monorepo)", type: "boolean" },
  tag: { alias: "t", description: "Default release tag", type: "string" },
  tags: { description: "Create git tags on release", type: "boolean" },
});

type InitCtx = Ctx<typeof initArgs>;

type InitFormValues = Omit<InitCtx["args"], "default" | "force">;

export class InitCommand extends BaseCommand {
  name = "init";
  description = "Initializes Sisyphus config or edits it";
  args = initArgs;

  async execute(ctx: InitCtx) {
    const { default: useDefault, force } = ctx.args;

    if (useDefault) {
      ctx.config.save(SISYPHUS_DEFAULT_CONFIG);
      await this.setLastStoneToHead(ctx);
      this.displaySuccessNote(ctx.cli.version);
      return;
    }

    if (!ctx.interactive && ctx.config.exists() && !force) {
      note(color.yellow("Config already exists. Use --force to replace."));
      return;
    }

    const currentConfig = ctx.config.getAll();
    const { default: _d, force: _f, ...argsValues } = ctx.args;
    const values = ctx.interactive ? await this.runInitForm(currentConfig) : argsValues;
    const newConfig = this.mapValuesToConfig(values);
    const mergedConfig = deepMerge<SisyphusConfig>({ ...currentConfig }, newConfig);

    ctx.config.save(mergedConfig);
    await this.setLastStoneToHead(ctx);
    this.displaySuccessNote(ctx.cli.version);
  }

  private mapValuesToConfig(v: InitFormValues): DeepPartial<SisyphusConfig> {
    const defined = <T extends object>(obj: T) =>
      Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined));
    const hasKeys = (obj: object) => Object.keys(obj).length > 0;

    const commit = defined({ author: v.commitAuthor, email: v.commitEmail, message: v.commitMessage });
    const changelog = defined({ generate: v.changelog, root: v.rootChangelog });
    const release = defined({ createRelease: v.createRelease, npm: v.npm, push: v.push, tags: v.tags });

    return {
      ...defined({ single: v.single, tag: v.tag }),
      ...(hasKeys(commit) && { commit }),
      ...(hasKeys(changelog) && { changelog }),
      ...(hasKeys(release) && { release }),
    };
  }

  private async runInitForm(currentConfig: SisyphusConfig): Promise<InitFormValues> {
    const values = await group(
      {
        changelog: () =>
          confirm({
            active: "Yes, generate changelog",
            inactive: "Skip changelog",
            initialValue: currentConfig.changelog?.generate ?? true,
            message: "Generate changelog for release?",
          }),
        configureCommit: () =>
          confirm({
            active: "Yes, configure commit",
            inactive: "Skip commit config",
            initialValue: !!(
              currentConfig.commit?.author ||
              currentConfig.commit?.email ||
              currentConfig.commit?.message
            ),
            message: "Configure commit for release? Default commit message is `release: <packageName@version>`",
          }),
        commitAuthor: ({ results: { configureCommit } }) =>
          configureCommit
            ? text({
                initialValue: currentConfig.commit?.author ?? "",
                message: "Commit author",
                placeholder: "r5n-bot",
              })
            : undefined,
        commitEmail: ({ results: { configureCommit } }) =>
          configureCommit
            ? text({
                initialValue: currentConfig.commit?.email ?? "",
                message: "Commit author email",
                placeholder: "r5n-bot@users.noreply.github.com",
              })
            : undefined,
        commitMessage: ({ results: { configureCommit } }) =>
          configureCommit
            ? text({
                initialValue: currentConfig.commit?.message ?? "",
                message: "Commit message",
                placeholder: "release: <packageName@version>",
              })
            : undefined,
        createRelease: () =>
          confirm({
            active: "Yes, create a release",
            inactive: "Skip release creation",
            initialValue: currentConfig.release?.createRelease ?? false,
            message: "Create a release on git provider when releasing packages?",
          }),
        npm: () =>
          confirm({
            active: "Yes, publish packages to NPM",
            inactive: "Skip NPM release",
            initialValue: currentConfig.release?.npm ?? false,
            message: "Publish packages to NPM when releasing packages?",
          }),
        push: () =>
          confirm({
            active: "Yes, push to remote",
            inactive: "No, keep local",
            initialValue: currentConfig.release?.push ?? false,
            message: "Should `roll` command push commits and tags to remote?",
          }),
        rootChangelog: ({ results: { changelog } }) =>
          changelog
            ? confirm({
                active: "Yes, generate combined changelog",
                inactive: "Skip root changelog",
                initialValue: currentConfig.changelog?.root ?? false,
                message: "Generate combined changelog for monorepo?",
              })
            : undefined,
        single: () =>
          confirm({
            active: "Yes, setup for root package",
            inactive: "No, setup for monorepo workspace packages",
            initialValue: currentConfig.single ?? false,
            message: "Setup Sisyphus for only root package?",
          }),
        tag: () =>
          text({
            initialValue: currentConfig.tag ?? "latest",
            message: "Tag used when versioning packages. Leave `latest` if you are not sure.",
            placeholder: "latest",
          }),
        tags: () =>
          confirm({
            active: "Yes, create tags for the release",
            inactive: "Skip tags",
            initialValue: currentConfig.release?.tags ?? false,
            message: "Create tags for the release?",
          }),
      },
      {
        onCancel: () => {
          throw new Cancel();
        },
      },
    );

    return {
      changelog: values.changelog,
      commitAuthor: values.commitAuthor,
      commitEmail: values.commitEmail,
      commitMessage: values.commitMessage,
      createRelease: values.createRelease,
      npm: values.npm,
      push: values.push,
      rootChangelog: values.rootChangelog,
      single: values.single,
      tag: values.tag,
      tags: values.tags,
    } as InitFormValues;
  }

  private async setLastStoneToHead(ctx: InitCtx) {
    try {
      const result = await Bun.$`git rev-parse HEAD`.quiet();
      const commit = result.stdout.toString().trim();
      if (commit) {
        ctx.config.set("lastStone", { commit, date: new Date().toISOString() });
      }
    } catch {}
  }

  private displaySuccessNote(version?: string) {
    note(
      `${color.magenta(`${color.bold("Sisyphus ")}${color.underline(color.italic(`v${version ?? "unknown"}`))}`)}${color.green(" is setup to roll stones.")}

You can now start by creating a new stone by running ${color.green(CLI_BIN)}${color.blue(" version")}
and following the prompts.

After you finished, you can release it by running ${color.green(CLI_BIN)}${color.blue(" roll")}
`,
    );
  }
}
