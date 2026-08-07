#!/usr/bin/env bash
# Compile-checks build/installer.nsh under BOTH makensis passes electron-builder runs, with -WX
# (warnings fatal) exactly as electron-builder does.
#
# Why this exists: a broken installer.nsh otherwise only surfaces partway through a ~4-minute
# Windows packaging job, and the failure mode is obscure ("install function ... not referenced")
# because the uninstaller pass compiles this file with none of the hooks that reference it. This
# runs on Linux in seconds. See nsis-lint/*.nsi for what each pass simulates.
#
# Local use: apt-get install nsis (or extract the .deb and point NSISDIR at it), then run this.
set -euo pipefail

cd "$(dirname "$0")/nsis-lint"

status=0
for pass in pass_uninstaller pass_installer; do
  echo "=== makensis -WX $pass.nsi"
  if ! makensis -WX "$pass.nsi"; then
    echo "!!! $pass FAILED"
    status=1
  fi
done

rm -f out_uninstaller.exe out_installer.exe

if [ $status -ne 0 ]; then
  echo "NSIS lint failed — installer.nsh would break the Windows build."
fi
exit $status
