import { existsSync } from "node:fs";
import { homedir } from "node:os";

import type { PresetDef } from "../types";

const home = homedir();

export const BUILT_IN_PRESETS: PresetDef[] = [
  {
    name: "brew",
    paths: ["/opt/homebrew/", `${home}/.Brewfile`, `${home}/Brewfile`],
    tags: ["packages", "macos"],
    detect: () => existsSync("/opt/homebrew/bin/brew"),
  },
  {
    name: "zsh",
    paths: [`${home}/.zshrc`, `${home}/.zprofile`, `${home}/.zshenv`],
    tags: ["shell"],
    detect: () => existsSync(`${home}/.zshrc`),
  },
  {
    name: "fish",
    paths: [`${home}/.config/fish/`],
    tags: ["shell"],
    detect: () => existsSync(`${home}/.config/fish/config.fish`),
  },
  {
    name: "git",
    paths: [`${home}/.gitconfig`, `${home}/.config/git/`],
    tags: ["git"],
    detect: () => existsSync(`${home}/.gitconfig`) || existsSync(`${home}/.config/git/config`),
  },
  {
    name: "ssh",
    paths: [`${home}/.ssh/config`, `${home}/.ssh/known_hosts`],
    tags: ["ssh"],
    detect: () => existsSync(`${home}/.ssh/config`),
  },
  {
    name: "nvim",
    paths: [`${home}/.config/nvim/`],
    tags: ["editor"],
    detect: () => existsSync(`${home}/.config/nvim/init.lua`) || existsSync(`${home}/.config/nvim/init.vim`),
  },
  {
    name: "vscode",
    paths: [
      `${home}/Library/Application Support/Code/User/settings.json`,
      `${home}/Library/Application Support/Code/User/keybindings.json`,
      `${home}/.config/Code/User/settings.json`,
      `${home}/.config/Code/User/keybindings.json`,
    ],
    tags: ["editor"],
    detect: () =>
      existsSync(`${home}/Library/Application Support/Code/User/settings.json`) ||
      existsSync(`${home}/.config/Code/User/settings.json`),
  },
  {
    name: "starship",
    paths: [`${home}/.config/starship.toml`],
    tags: ["shell", "prompt"],
    detect: () => existsSync(`${home}/.config/starship.toml`),
  },
  {
    name: "alacritty",
    paths: [`${home}/.config/alacritty/`],
    tags: ["terminal"],
    detect: () => existsSync(`${home}/.config/alacritty/alacritty.toml`) || existsSync(`${home}/.config/alacritty/alacritty.yml`),
  },
  {
    name: "wezterm",
    paths: [`${home}/.wezterm.lua`, `${home}/.config/wezterm/`],
    tags: ["terminal"],
    detect: () => existsSync(`${home}/.wezterm.lua`) || existsSync(`${home}/.config/wezterm/wezterm.lua`),
  },
];
