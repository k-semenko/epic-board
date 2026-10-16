#!/usr/bin/env bash
# Installs (or removes) the self-hosted GitHub Actions runner for epic-board on
# Ubuntu 22.04 / 24.04, x64 or arm64. Idempotent: re-running upgrades pinned bits.
#
#   sudo RUNNER_TOKEN=<registration token> bash setup-runner.sh
#   sudo RUNNER_TOKEN=<removal token> bash setup-runner.sh --uninstall
#
# Registration token (valid 1 hour):
#   gh api -X POST repos/k-semenko/epic-board/actions/runners/registration-token --jq .token
# Removal token:
#   gh api -X POST repos/k-semenko/epic-board/actions/runners/remove-token --jq .token
#
# Hardening:
# - Jobs run as the dedicated system user gh-runner: no sudo, no login shell,
#   home /opt/gh-runner. Do not add it to sudo or docker groups.
# - Workflows route only push-to-main and v* tag jobs here (see .github/workflows);
#   pull requests from forks always run on GitHub-hosted runners.
# - Self-update is disabled so the binary stays at the pinned, checksum-verified
#   version. GitHub stops sending jobs to outdated runners: bump RUNNER_VERSION
#   and its hashes below (from the actions/runner release notes) and re-run.
set -euo pipefail

REPO="${REPO:-k-semenko/epic-board}"
RUNNER_NAME="${RUNNER_NAME:-$(hostname -s)}"
RUNNER_LABELS="${RUNNER_LABELS:-epic-board}"
RUNNER_TOKEN="${RUNNER_TOKEN:-}"
RUNNER_USER="gh-runner"
RUNNER_HOME="/opt/gh-runner"
RUNNER_DIR="${RUNNER_HOME}/actions-runner"

RUNNER_VERSION="2.338.0"
RUNNER_SHA256_X64="af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32"
RUNNER_SHA256_ARM64="628b4a7258487b80c1d3c221095a7ded349f5ae0175fd3dfab708d07428f041b"

NODE_VERSION="22.23.3"
NODE_PREFIX="/opt/node"

MODE="install"

usage() {
  cat <<EOF
Usage: sudo [RUNNER_TOKEN=...] bash $0 [--repo OWNER/NAME] [--name NAME] [--token TOKEN | --token-stdin] [--uninstall]

Environment / flags:
  REPO           --repo       repository (default: ${REPO})
  RUNNER_NAME    --name       runner name (default: short hostname)
  RUNNER_TOKEN   --token      registration token, or removal token with --uninstall
  RUNNER_LABELS               extra labels (default: epic-board)

Get a registration token:
  gh api -X POST repos/${REPO}/actions/runners/registration-token --jq .token
Get a removal token:
  gh api -X POST repos/${REPO}/actions/runners/remove-token --jq .token
EOF
}

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:?}"; shift 2 ;;
    --name) RUNNER_NAME="${2:?}"; shift 2 ;;
    --token) RUNNER_TOKEN="${2:?}"; shift 2 ;;
    # Reading the token from stdin keeps it out of ps and shell history on the host.
    --token-stdin) IFS= read -r RUNNER_TOKEN; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || die "run as root: sudo bash $0"

as_runner() {
  runuser -u "${RUNNER_USER}" -- env HOME="${RUNNER_HOME}" "$@"
}

detect_platform() {
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || die "Ubuntu required, found ${ID:-unknown}"
  case "${VERSION_ID:-}" in
    22.04|24.04) ;;
    *) log "warning: tested on Ubuntu 22.04/24.04, found ${VERSION_ID:-unknown}" ;;
  esac
  case "$(uname -m)" in
    x86_64) RUNNER_ARCH="x64"; NODE_ARCH="x64"; RUNNER_SHA256="${RUNNER_SHA256_X64}" ;;
    aarch64|arm64) RUNNER_ARCH="arm64"; NODE_ARCH="arm64"; RUNNER_SHA256="${RUNNER_SHA256_ARM64}" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
}

install_packages() {
  log "apt prerequisites"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q --no-install-recommends git curl ca-certificates jq tar xz-utils gnupg
}

install_gh() {
  log "GitHub CLI from cli.github.com apt repository"
  local keyring=/etc/apt/keyrings/githubcli-archive-keyring.gpg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "${keyring}.tmp"
  mv "${keyring}.tmp" "${keyring}"
  chmod 0644 "${keyring}"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=${keyring}] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -q
  apt-get install -y -q gh
}

install_node() {
  if [[ -x "${NODE_PREFIX}/bin/node" ]] && [[ "$("${NODE_PREFIX}/bin/node" --version)" == "v${NODE_VERSION}" ]]; then
    log "Node v${NODE_VERSION} already installed"
  else
    log "Node v${NODE_VERSION} (${NODE_ARCH}) from nodejs.org"
    local tmp file
    tmp="$(mktemp -d)"
    file="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${file}" -o "${tmp}/${file}"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "${tmp}/SHASUMS256.txt"
    (cd "${tmp}" && grep -E "  ${file}\$" SHASUMS256.txt | sha256sum -c -) || die "Node checksum mismatch"
    rm -rf "${NODE_PREFIX}.new"
    install -d -m 0755 "${NODE_PREFIX}.new"
    tar -xJf "${tmp}/${file}" -C "${NODE_PREFIX}.new" --strip-components=1 --no-same-owner
    rm -rf "${NODE_PREFIX}"
    mv "${NODE_PREFIX}.new" "${NODE_PREFIX}"
    rm -rf "${tmp}"
  fi
  local bin
  for bin in node npm npx corepack; do
    if [[ -e "${NODE_PREFIX}/bin/${bin}" ]]; then
      ln -sfn "${NODE_PREFIX}/bin/${bin}" "/usr/local/bin/${bin}"
    fi
  done
}

create_user() {
  if id -u "${RUNNER_USER}" >/dev/null 2>&1; then
    log "user ${RUNNER_USER} exists"
  else
    log "creating system user ${RUNNER_USER}"
    useradd --system --home-dir "${RUNNER_HOME}" --create-home --shell /usr/sbin/nologin "${RUNNER_USER}"
  fi
  install -d -o "${RUNNER_USER}" -g "${RUNNER_USER}" -m 0750 "${RUNNER_HOME}" "${RUNNER_DIR}"
  if id -nG "${RUNNER_USER}" | tr ' ' '\n' | grep -qxE 'sudo|admin|wheel|docker'; then
    die "${RUNNER_USER} is in a privileged group; remove it first"
  fi
}

install_runner() {
  local file="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
  local marker="${RUNNER_DIR}/.epic-board-runner-version"
  if [[ -f "${marker}" ]] && [[ "$(cat "${marker}")" == "${RUNNER_VERSION}" ]]; then
    log "actions/runner ${RUNNER_VERSION} already unpacked"
    return
  fi
  if [[ -f "${RUNNER_DIR}/.runner" ]]; then
    log "stopping service before upgrade"
    (cd "${RUNNER_DIR}" && ./svc.sh stop) || true
  fi
  log "actions/runner ${RUNNER_VERSION} (${RUNNER_ARCH})"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${file}" -o "${tmp}/${file}"
  echo "${RUNNER_SHA256}  ${tmp}/${file}" | sha256sum -c - || die "actions/runner checksum mismatch"
  tar -xzf "${tmp}/${file}" -C "${RUNNER_DIR}" --no-same-owner
  rm -rf "${tmp}"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_DIR}"
  log "runner OS dependencies"
  "${RUNNER_DIR}/bin/installdependencies.sh"
  echo "${RUNNER_VERSION}" > "${marker}"
  chown "${RUNNER_USER}:${RUNNER_USER}" "${marker}"
}

configure_runner() {
  cd "${RUNNER_DIR}"
  if [[ -f .runner ]]; then
    log "runner already registered; skipping config.sh"
  else
    [[ -n "${RUNNER_TOKEN}" ]] || { usage >&2; die "RUNNER_TOKEN is required to register the runner"; }
    log "registering runner ${RUNNER_NAME} for ${REPO}"
    as_runner ./config.sh --unattended \
      --url "https://github.com/${REPO}" \
      --token "${RUNNER_TOKEN}" \
      --name "${RUNNER_NAME}" \
      --labels "${RUNNER_LABELS}" \
      --work _work \
      --replace \
      --disableupdate
  fi
  if [[ -f .service ]]; then
    log "systemd service already installed"
  else
    ./svc.sh install "${RUNNER_USER}"
  fi
  ./svc.sh start
}

uninstall_runner() {
  [[ -d "${RUNNER_DIR}" ]] || { log "nothing to remove at ${RUNNER_DIR}"; return; }
  cd "${RUNNER_DIR}"
  # Check the token first: stopping the service and then failing would leave a registered, dead runner.
  if [[ -f .runner && -z "${RUNNER_TOKEN}" ]]; then
    usage >&2
    die "RUNNER_TOKEN (removal token) is required for --uninstall"
  fi
  if [[ -f .service ]]; then
    ./svc.sh uninstall
  fi
  if [[ -f .runner ]]; then
    as_runner ./config.sh remove --token "${RUNNER_TOKEN}"
  fi
  log "runner unregistered; ${RUNNER_USER}, ${RUNNER_HOME}, Node and gh are left in place"
}

if [[ "${MODE}" == "uninstall" ]]; then
  uninstall_runner
  exit 0
fi

detect_platform
install_packages
install_gh
install_node
create_user
install_runner
configure_runner
log "done: runner ${RUNNER_NAME} (labels: self-hosted, linux, ${RUNNER_LABELS}) for ${REPO}"
