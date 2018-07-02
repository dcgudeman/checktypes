/**
 * Copyright (c) 2018-present, David Gudeman
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
"use strict";

const util = require("util");
const execFile = util.promisify(require("child_process").execFile);
const path = require("path");
const flow = require("flow-bin");
const git = require("simple-git/promise");

class TypeChecker {
  constructor(repoPath, config) {
    if (!repoPath) {
      throw new Error("must pass in path to git tracked directory");
    }

    this.repoPath = path.resolve(repoPath || ".");
    this.basePath = path.resolve(".");
    this.repo = git(this.repoPath);
    this.commitRange = null;

    if (config) {
      if (config.commitRange) {
        this.commitRange = config.commitRange;
      }
      if (config.basePath) {
        this.basePath = path.resolve(config.basePath);
      }
    }
  }

  async getTargetFiles() {
    let gitOutput;
    if (this.commitRange) {
      gitOutput = await this.repo.diff(["--name-status", this.commitRange]);
    } else {
      gitOutput = await this.repo.diff(["--name-status", "--cached"]);
    }
    const tempArray = gitOutput.split(/\s+/);
    tempArray.pop(); // extra empty string at the end of array
    const files = [];
    for (let i = 0; i < tempArray.length; i += 2) {
      if (tempArray[i] !== "D") {
        files.push(path.resolve(this.repoPath, tempArray[i + 1]));
      }
    }

    return files;
  }

  async flowFocusCheck(files) {
    const filteredFiles = files
      .map(absolute => path.relative(this.basePath, absolute))
      .filter(file => file[0] !== "."); // filtering out things above current directory and dotfiles
    const filesSet = new Set(filteredFiles); // this removes potential duplicate files
    const flowLsResult = await execFile(flow, ["ls", "--json"]);
    const visibleFiles = JSON.parse(flowLsResult.stdout).map(absolute =>
      path.relative(this.basePath, absolute)
    );

    const visibleFilesSet = new Set(visibleFiles);
    const intersection = [...filesSet]
      .filter(file => visibleFilesSet.has(file))
      .map(file => path.relative(this.basePath, file));

    const result = {
      success: null,
      errors: null
    };
    try {
      const focusCheckResult = await execFile(flow, [
        "focus-check",
        "--json",
        "--show-all-errors",
        ...intersection
      ]);
      result.success = JSON.parse(focusCheckResult.stdout);
    } catch (topLevelError) {
      if (topLevelError.stdout) {
        const stdout = JSON.parse(topLevelError.stdout);
        if (stdout.errors) {
          result.errors = stdout.errors.filter(error => {
            if (error.message.length && error.message[0].path) {
              const flowErrorMessage = error.message[0];
              return files.includes(flowErrorMessage.path);
            }
          });
        }
      } else if (topLevelError.stderr) {
        console.error(topLevelError.stderr);
      } else if (topLevelError.message) {
        console.error(topLevelError.message);
      }
    }
    return result;
  }
}

module.exports = TypeChecker;
