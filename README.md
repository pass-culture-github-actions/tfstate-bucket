# Changed ArgoCD app - GitHub Actions

## What is it ?

GitHub action to retrieve argocd app edited in a PR.

## Usage

### Classic usage

```yml
on: pull_request

jobs:
  argocd-apps:
    runs-on: ubuntu-latest
    name: An example job that return argocd list of app with changes
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Get changed files
        id: changed-files
        uses: tj-actions/changed-files@v42
      - name: Get argocd app list concerned by changes
        uses: pass-culture-github-actions/changed-argocd-app@v1.0.0
        with:
          all_modified_files: ${{ steps.changed-files.outputs.all_modified_files }} # From tj-actions/changed-files
```


## Inputs

### Action inputs

| Name | Description | Required | Default |
| --- | --- | --- | --- |
| `all_modified_files` | From tj-actions/changed-files: Returns all changed files i.e. a combination of all added, copied, modified and renamed files (ACMR) | ✅ | |



## Outputs

### Action outputs

You can get some outputs from this actions :

| Name   | Description                         |
| ------ | ----------------------------------- |
| `apps` | The list of ArgoCD app with changes |

### Example output

```yaml
- uses: pass-culture-github-actions/changed-argocd-app@v1.0.0
  id: argocd-apps
  with:
    all_modified_files: ${{ steps.changed-files.outputs.all_modified_files }} # From tj-actions/changed-files
- name: Check apps
  run: |
    echo "${{ steps.argocd-apps.outputs.apps }}"
    # With `steps.argocd-apps.outputs.apps='posthog clickhouse external-dns'`
    # Outputs : `posthog clickhouse external-dns`
```


## Contributing

### Build

The build steps transpiles the `src/main.ts` to `lib/index.js` which is used in a NodeJS environment.
It is handled by `vercel/ncc` compiler.

```sh
$ npm run build
```
