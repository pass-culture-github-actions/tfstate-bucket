import * as github from '@actions/github';
import * as core from '@actions/core';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';

import { readFileSync } from 'fs'
import { resolve } from 'path'


async function run() {
  try {
    const allModifiedFiles = core.getInput('all_modified_files').split(' ');

    async function createApps() {
      const map = new Map()
      const apps = []
      const { execa } = await import('execa')

      const { stdout, stderr } = await execa('argocd', ['app', 'list', '--core', '--output', 'json']);
      if (stderr) {
        throw new Error(stderr)
      }
      const json = JSON.parse(stdout) // key = path, value = name
      for (const app of json) {
        const appName = app.metadata.name
        const appPath = app.spec.source.path
        map.set(appPath, map.has(appPath) ? [...map.get(appPath), appName] : [appName])
      }

      for (const allModifiedFile of allModifiedFiles) {
        for (const [key, value] of map) {
          if (`./${allModifiedFile}`.includes(key)) {
            apps.push(value.find((v: string) => allModifiedFile.includes(v)))
          }
        }
      }

      core.setOutput('apps', apps.join(' '));
    }

    await createApps();
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
