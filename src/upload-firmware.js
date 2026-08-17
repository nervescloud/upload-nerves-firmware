import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import path from 'path'
import fs from 'fs'

const CLI_REPO = 'nerves-hub/nh'
const CLI_TOOL_NAME = 'nh'

async function run () {
  const version = await installCLI()
  core.setOutput('cli-version', version)

  const env = cliEnv()
  const workingDirectory = resolveWorkingDirectory()
  const firmwarePath = resolveFirmwarePath(workingDirectory)

  const firmware = await uploadFirmware(firmwarePath, workingDirectory, env)
  core.setOutput('firmware-uuid', firmware.uuid)
  core.setOutput('firmware-version', firmware.version)

  const deployment = core.getInput('deployment', { required: false })
  if (deployment !== '') {
    await updateDeployment(deployment, firmware, workingDirectory, env)
    core.notice(
      `Firmware ${firmware.version} (${firmware.uuid}) uploaded and deployed to ${deployment}`
    )
  } else {
    core.notice(`Firmware ${firmware.version} (${firmware.uuid}) uploaded`)
  }
}

// The CLI reads its configuration from NERVES_HUB_* environment variables.
// URI, org, product and token are exported so later steps in the job can run
// `nh` themselves; the signing key is passed per-command so it never lands in
// the job environment.
function cliEnv () {
  const uri = core.getInput('uri', { required: false })
  if (uri !== '') {
    core.exportVariable('NERVES_HUB_URI', uri)
    core.info(`Platform URI set to ${uri}`)
  }

  core.exportVariable('NERVES_HUB_ORG', core.getInput('org', { required: true }))
  core.exportVariable(
    'NERVES_HUB_PRODUCT',
    core.getInput('product', { required: true })
  )

  const token = core.getInput('token', { required: true })
  core.setSecret(token)
  core.exportVariable('NERVES_HUB_TOKEN', token)

  if (core.getInput('public-key', { required: false }) !== '') {
    core.warning(
      'The `public-key` input is no longer used and can be removed: signing only needs the private key.'
    )
  }

  const privateKey = core.getInput('private-key', { required: true }).trim()
  core.setSecret(privateKey)

  return {
    ...process.env,
    NERVES_HUB_PRIVATE_KEY: privateKey,
    NERVES_HUB_NON_INTERACTIVE: 'true'
  }
}

async function installCLI () {
  const requestedVersion = core.getInput('version', { required: true })
  const version = await resolveVersion(requestedVersion)

  let installDir = tc.find(CLI_TOOL_NAME, version)
  if (installDir === '') {
    const { os, arch, archive, extension } = releaseAsset(version)
    const downloadUri = `https://github.com/${CLI_REPO}/releases/download/v${version}/${archive}`

    core.info(`Downloading ${CLI_TOOL_NAME} ${version} for ${os}/${arch}`)
    const pathToArchive = await tc.downloadTool(downloadUri)
    const extractedDir =
      extension === 'zip'
        ? await tc.extractZip(pathToArchive)
        : await tc.extractTar(pathToArchive)

    installDir = await tc.cacheDir(extractedDir, CLI_TOOL_NAME, version)
  }

  core.debug(`CLI installed at ${installDir}`)
  core.addPath(installDir)

  // `nh --version` prints "nh <version> (<commit>) <date>"; the semver is all
  // we report, and running it confirms the binary actually works.
  let versionOutput = ''
  await exec.exec(CLI_TOOL_NAME, ['--version'], {
    silent: true,
    listeners: {
      stdout: (data) => (versionOutput += data.toString())
    }
  })

  const reportedVersion = versionOutput.trim().split(/\s+/)[1] || version
  core.info(`Version ${reportedVersion} of the NervesCloud CLI installed`)
  return reportedVersion
}

// `latest` is resolved to a concrete version because the release archives are
// named after it, so there is no fixed "latest" download URL.
async function resolveVersion (requestedVersion) {
  if (requestedVersion !== 'latest') {
    return requestedVersion.replace(/^v/, '')
  }

  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(
    `https://api.github.com/repos/${CLI_REPO}/releases/latest`,
    { headers }
  )
  if (!response.ok) {
    throw new Error(
      `Could not look up the latest ${CLI_TOOL_NAME} release (HTTP ${response.status}). Pin the \`version\` input to work around this.`
    )
  }

  const { tag_name: tagName } = await response.json()
  return tagName.replace(/^v/, '')
}

function releaseAsset (version) {
  const platforms = { linux: 'linux', darwin: 'darwin', win32: 'windows' }
  const architectures = { x64: 'amd64', arm64: 'arm64' }

  const os = platforms[process.platform]
  const arch = architectures[process.arch]
  if (!os || !arch) {
    throw new Error(
      `Unsupported runner platform ${process.platform}/${process.arch}: the ${CLI_TOOL_NAME} CLI ships for linux, darwin and windows on amd64 and arm64.`
    )
  }

  const extension = os === 'windows' ? 'zip' : 'tar.gz'
  return {
    os,
    arch,
    extension,
    archive: `${CLI_TOOL_NAME}_${version}_${os}_${arch}.${extension}`
  }
}

function resolveWorkingDirectory () {
  const workingDirectory = core.getInput('working-directory', {
    required: false
  })
  return path.resolve(process.env.GITHUB_WORKSPACE, workingDirectory)
}

// The CLI always takes an explicit firmware path, so when the `firmware` input
// is omitted fall back to the image Nerves builds into
// _build/<target>_<env>/nerves/images.
function resolveFirmwarePath (workingDirectory) {
  const firmwareInput = core.getInput('firmware', { required: false })
  if (firmwareInput !== '') {
    return path.resolve(workingDirectory, firmwareInput)
  }

  const buildDir = path.join(workingDirectory, '_build')
  const candidates = readDir(buildDir)
    .flatMap((target) => {
      const imagesDir = path.join(buildDir, target, 'nerves', 'images')
      return readDir(imagesDir)
        .filter((file) => file.endsWith('.fw'))
        .map((file) => path.join(imagesDir, file))
    })

  if (candidates.length === 0) {
    throw new Error(
      `No firmware found under ${buildDir}. Set the \`firmware\` input to the path of the .fw file to upload.`
    )
  }
  if (candidates.length > 1) {
    throw new Error(
      `Found more than one firmware file (${candidates.join(', ')}). Set the \`firmware\` input to pick one.`
    )
  }

  core.info(`Found firmware at ${candidates[0]}`)
  return candidates[0]
}

function readDir (dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

async function uploadFirmware (firmwarePath, workingDirectory, env) {
  const args = ['firmware', 'upload', firmwarePath, '--output', 'json']

  let stdout = ''
  await exec.exec(CLI_TOOL_NAME, args, {
    cwd: workingDirectory,
    env,
    listeners: {
      stdout: (data) => (stdout += data.toString())
    }
  })

  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`Could not read the uploaded firmware details from: ${stdout}`)
  }
}

async function updateDeployment (deployment, firmware, workingDirectory, env) {
  await exec.exec(
    CLI_TOOL_NAME,
    ['deployment', 'update', deployment, '--firmware', firmware.uuid],
    { cwd: workingDirectory, env }
  )
}

(async () => {
  try {
    await run()
  } catch (error) {
    core.setFailed(error.message)
  }
})()
