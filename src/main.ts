import * as github from '@actions/github';
import * as core from '@actions/core';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';

import fs from 'fs';
import path from 'path';

const TMP_DIR = '/tmp/tfstate';
const RM_OPTIONS = { recursive: true }
const RM_CALLBACK: any = (error: Error) => {
  if (error) {
    console.log(error.message);
  }
}

function findFileWithNameRecursively(directory: string, fileName: string): Array<string> {
  const filePaths = [];
  try {
    const files = fs.readdirSync(directory)
    for (const file of files) {
      const filePath = path.join(directory, file);
      try {
        const fileStat = fs.statSync(filePath)
        if (fileStat.isDirectory()) {
          filePaths.push(findFileWithNameRecursively(filePath, fileName));
        } else if (file.endsWith(fileName)) {
          filePaths.push(filePath);
        }
      } catch (syncError) {
        throw syncError;
      }
    }
  } catch (error) {
    throw error;
  }
  return filePaths.flat(Infinity) as Array<string>
}

function filterEmptyTfState(tfStatePath: string) {
  const { outputs, resources } = JSON.parse(fs.readFileSync(tfStatePath, 'utf8'));
  return Object.values(outputs).length === 0 && resources.length === 0;
}

function makeFilterMatchNotExist(terragruntHclFilePaths: string[], terragruntDirectory: string, terragruntBucketDirectory: string): (path: string) => boolean {
  return (tfStatePath: string) => {
    let exist = false;
    for (const terragruntHclFilePath of terragruntHclFilePaths) {
      const compare = `${terragruntDirectory}${tfStatePath.replace(`${TMP_DIR}/${terragruntBucketDirectory}`, '').replace('default.tfstate', 'terragrunt.hcl')}`
      if (terragruntHclFilePath.endsWith(compare)) {
        exist = true;
        break;
      }
    }
    return !exist;
  }
}

async function run() {
  const { execa } = await import('execa');

  async function getPrOpenOrDraftNumbers(baseRef: string) {
    const { stdout } = await execa('gh', ['pr', 'list', '--base', baseRef, '--limit', '1000000', '--json', 'number']);
    const prNumbers = JSON.parse(stdout).map(({ number }: { number: number }) => number);
    return prNumbers;
  }

  async function getFilePathsFromPrnumber(prNumber: number) {
    const { stdout } = await execa('gh', ['pr', 'diff', String(prNumber), '--name-only']);
    const filePaths = stdout.split('\n')
      .filter((filePath: string) => filePath.endsWith('terragrunt.hcl'))
      .filter((filePath: string) => !!filePath);
    return filePaths;
  }

  function getEmptyTfStateFilePaths(): string[] {
    const tfStateFilePaths = findFileWithNameRecursively(TMP_DIR, 'default.tfstate');
    const emptyTfStateFilePaths = tfStateFilePaths.filter(filterEmptyTfState);
    console.log(`Total default.tfstate count: ${tfStateFilePaths.length}`);

    if (emptyTfStateFilePaths.length > 0) {
      console.log(`::group::default.tfstate (${emptyTfStateFilePaths.length})`);
      console.log(emptyTfStateFilePaths.join('\n'));
      console.log('::endgroup::');
    } else {
      console.log('default.tfstate (0)');
    }

    core.setOutput('empty-tfstate-filepaths', emptyTfStateFilePaths.join(' '));
    core.setOutput('empty-tfstate-filepaths-count', `${emptyTfStateFilePaths.length}`);
    return emptyTfStateFilePaths
  }

  function getMismatchFilePaths({
    terragruntDirectory,
    terragruntBucketDirectory,
    mismatchFilePathsPrs,
    baseRef
  }: {
    terragruntDirectory: string,
    terragruntBucketDirectory: string,
    mismatchFilePathsPrs: string[],
    baseRef: string
  }): string[] {
    const tfStateFilePathsToCompare = findFileWithNameRecursively(TMP_DIR, 'default.tfstate')
      .filter((tfStateFilepath) => tfStateFilepath.startsWith(`${TMP_DIR}/${terragruntBucketDirectory}`));
    const terragruntHclFilePaths = findFileWithNameRecursively(`${process.cwd()}/${terragruntDirectory}`, 'terragrunt.hcl');
    const mismatchFilePaths = tfStateFilePathsToCompare.filter(makeFilterMatchNotExist(terragruntHclFilePaths, terragruntDirectory, terragruntBucketDirectory))

    const terragruntHclFromPrsFilePaths = mismatchFilePathsPrs.map((filePath: string) => `${process.cwd()}/${filePath}`);
    const mismatchFileAfterPrsFilePaths = mismatchFilePaths.filter(makeFilterMatchNotExist(terragruntHclFromPrsFilePaths, terragruntDirectory, terragruntBucketDirectory))

    const diffFilePaths = mismatchFilePaths.filter((filePath: string) => !mismatchFileAfterPrsFilePaths.includes(filePath))

    if ((mismatchFilePathsPrs.length - mismatchFileAfterPrsFilePaths.length) > 0) {
      console.log(`::group::PR states currently being edited (${mismatchFilePathsPrs.length})`);
      console.log(mismatchFilePathsPrs.join('\n'));
      console.log('::endgroup::')
    } else {
      console.log('PR states currently being edited (0)');
    }

    if (mismatchFilePaths.length > 0) {
      console.log(`::group::mismatch on ref ${baseRef} (${mismatchFilePaths.length})`);
      console.log(mismatchFilePaths.join('\n'));
      console.log('::endgroup::')
    } else {
      console.log(`mismatch on ref ${baseRef} (0)`);
    }

    if (diffFilePaths.length > 0) {
      console.log(`::group::mismatch involving PRs (${diffFilePaths.length})`);
      console.log(diffFilePaths.join('\n'));
      console.log('::endgroup::')
    } else {
      console.log('mismatch involving PRs (0)');
    }

    if (mismatchFileAfterPrsFilePaths.length > 0) {
      console.log(`::group::mismatch (${mismatchFileAfterPrsFilePaths.length})`);
      console.log(mismatchFileAfterPrsFilePaths.join('\n'));
      console.log('::endgroup::')
    } else {
      console.log('mismatch (0)');
    }

    core.setOutput('tfstate-mismatch-filepaths', mismatchFilePaths.join(' '));
    core.setOutput('tfstate-mismatch-filepaths-count', `${mismatchFilePaths.length}`);

    core.setOutput('tfstate-mismatch-filepaths-from-pr', diffFilePaths.join(' '));
    core.setOutput('tfstate-mismatch-filepaths-from-pr-count', `${diffFilePaths.length}`);

    return mismatchFileAfterPrsFilePaths;
  }

  async function getTerragruntCacheFilePaths(): Promise<string[]> {
    const { stdout } = await execa('find', [TMP_DIR, '-type', 'd', '-name', '.terragrunt-cache']);
    const terragruntCacheFilePaths = stdout.replace(/\n/g, " ").split(' ').filter((path: string) => !!path.trim());

    if (terragruntCacheFilePaths.length > 0) {
      console.log(`::group::.terragrunt-cache (${terragruntCacheFilePaths.length})`);
      console.log(terragruntCacheFilePaths.join('\n'));
      console.log('::endgroup::');
    } else {
      console.log('.terragrunt-cache (0)');
    }

    core.setOutput('terragrunt-cache-filepaths', terragruntCacheFilePaths.join(' '));
    core.setOutput('terragrunt-cache-filepaths-count', `${terragruntCacheFilePaths.length}`);
    return terragruntCacheFilePaths;
  }

  const terragruntCache = core.getBooleanInput('terragrunt-cache');
  const tfstate = core.getBooleanInput('tfstate');
  const mismatch = core.getBooleanInput('mismatch');
  const mismatchBaseRef = core.getInput('mismatch-base-ref')
  const push = core.getBooleanInput('push');
  const project: string = core.getInput('project');
  const bucket: string = core.getInput('bucket');
  const terragruntDirectory: string = core.getInput('terragrunt-directory');
  const terragruntBucketDirectory: string = core.getInput('terragrunt-bucket-directory');

  core.debug(
    JSON.stringify({
      terragruntCache: terragruntCache,
      tfstate: tfstate,
      terragruntDirectory: terragruntDirectory,
      mismatch: mismatch,
      mismatchBaseRef: mismatchBaseRef,
      push: push,
      project: project,
      bucket: bucket,
    }, null, 2)
  );

  let emptyTfStatFilePaths: string[] = [];
  let terragruntCacheFilePaths: string[] = [];
  let mismatchFilePaths: string[] = [];
  let mismatchFilePathsPrs: string[] = [];

  try {
    const prNumbers = await getPrOpenOrDraftNumbers(mismatchBaseRef)
    for (let prNumber of prNumbers) {
      const prFilePaths = await getFilePathsFromPrnumber(prNumber)
      mismatchFilePathsPrs = [...mismatchFilePathsPrs, ...prFilePaths]
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }

  try {
    const { stdout } = await execa('gcloud', ['--version']);
  } catch (error) {
    if ((error as any).code as string === 'ENOENT') {
      core.setFailed('You must have gcloud CLI installed.');
    } else if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }

  try {
    await execa('mkdir', ['-p', TMP_DIR]);
  } catch(error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }

  try {
    const { stdout } = await execa('gcloud', ['storage', 'rsync', '--recursive', '--project', project, `gs://${bucket}`, TMP_DIR]);
    console.log(`Pulling tfstate bucket gs://${bucket}...`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }

  try {
    emptyTfStatFilePaths = getEmptyTfStateFilePaths()
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }

  try {
    terragruntCacheFilePaths = await getTerragruntCacheFilePaths()
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }

  try {
    mismatchFilePaths = await getMismatchFilePaths({
      terragruntDirectory,
      terragruntBucketDirectory,
      mismatchFilePathsPrs,
      baseRef: mismatchBaseRef,
    })
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }


  if (tfstate) {
    emptyTfStatFilePaths.forEach(fs.unlinkSync);
  }
  if (terragruntCache) {
    terragruntCacheFilePaths.forEach((folder: string) => {
      if (fs.existsSync(folder)) {
        fs.rm(folder, RM_OPTIONS, RM_CALLBACK);
      }
    });
  }
  if (mismatch) {
    mismatchFilePaths.forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    });
  }

  console.log(`${push ? '' : '[DRYRUN] '}Pushing tfstate bucket gs://${bucket}...`);

  if (push) {
    try {
      await execa('gcloud', [
        'storage',
        'rsync',
        '--recursive',
        '--delete-unmatched-destination-objects',
        '--project',
        project,
        TMP_DIR,
        `gs://${bucket}`
      ]);

      if (tfstate) {
        getEmptyTfStateFilePaths(); // refresh output count
      }
      if (terragruntCache) {
        await getTerragruntCacheFilePaths(); // refresh output count
      }
      if (mismatch) {
        await getMismatchFilePaths({
          terragruntDirectory,
          terragruntBucketDirectory,
          mismatchFilePathsPrs,
          baseRef: mismatchBaseRef,
        }); // refresh output count
      }

    } catch (error) {
      if (error instanceof Error) {
        core.setFailed(error.message);
      }
      return;
    }
  } else {
    try {
      await execa('gcloud', [
        'storage',
        'rsync',
        '--dry-run',
        '--recursive',
        '--delete-unmatched-destination-objects',
        '--project',
        project,
        TMP_DIR,
        `gs://${bucket}`
      ]);

      console.log('No change will be written to bucket. Use input.push: true to apply');
    } catch (err) {
      if (err instanceof Error) {
        core.setFailed(err.message);
      }
      return;
    }
  }

  try {
    core.debug('Cleaning locally cloned tfstate bucket');
    await execa('rm', ['--force', '--recursive', TMP_DIR]);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
    return;
  }
}

run();
