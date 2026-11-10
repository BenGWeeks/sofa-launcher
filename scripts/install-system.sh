#!/usr/bin/env bash
# Install or update Sofa Launcher system-wide. Run by an administrator (needs sudo).
#
#   sudo ./install-system.sh sofa-launcher_<ver>_amd64.deb <expected-sha256>
#
# The expected SHA256 comes from the release's SHA256SUMS (or the PR/build log),
# obtained separately from the .deb, so a tampered file is refused.
# Installs to /opt/sofa-launcher with an AppArmor profile for that root-owned
# path (Electron's OS sandbox; see spikes/s1-sandbox). Never use --no-sandbox.
set -euo pipefail

die() { echo "install-system: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ $# -eq 2 ]] || die "usage: sudo $0 <path/to/sofa-launcher_VER_amd64.deb> <sha256>"
deb=$1
expected=${2,,}
[[ -f $deb ]] || die "no such file: $deb"
[[ $expected =~ ^[0-9a-f]{64}$ ]] || die "second argument must be a 64-character SHA256"

# Work on a root-owned copy so the file can't be swapped between check and install (TOCTOU).
tmp=$(mktemp -d /var/tmp/sofa-install.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
cp -- "$deb" "$tmp/pkg.deb"
chmod 644 "$tmp/pkg.deb"
deb=$tmp/pkg.deb

actual=$(sha256sum -- "$deb" | cut -d' ' -f1)
[[ $actual == "$expected" ]] || die "SHA256 mismatch: expected $expected, got $actual. Refusing to install."

pkg=$(dpkg-deb --field "$deb" Package)
ver=$(dpkg-deb --field "$deb" Version)
[[ $pkg == sofa-launcher ]] || die "unexpected package name: $pkg"
contents=$(dpkg-deb --contents "$deb" | awk '{print $6}')
grep -qx './opt/sofa-launcher/sofa-launcher' <<<"$contents" || die "package doesn't install to /opt/sofa-launcher"
grep -qx './opt/sofa-launcher/resources/apparmor-profile' <<<"$contents" || die "package has no AppArmor profile"

echo "Installing $pkg $ver (SHA256 verified)…"
apt-get install -y --no-install-recommends "$deb"

if [[ ! -f /etc/apparmor.d/sofa-launcher ]]; then
  apt-get remove -y sofa-launcher || true
  die "AppArmor profile missing after install; removed the package again"
fi
echo
echo "Installed $pkg $ver to /opt/sofa-launcher."
echo "Now, as the TV user in the TV session, check the sandbox:"
echo "    sofa-launcher --self-check     # must print \"ok\": true"
