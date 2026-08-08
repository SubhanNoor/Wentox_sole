; Harness reproducing electron-builder's SECOND makensis pass — the real installer, where both
; customPageAfterChangeDir and customInstall are inserted. Verifies the custom pages actually
; compile and that every function/macro they reference resolves (e.g. WordFunc's ${WordReplace},
; which needs an explicit !insertmacro WordReplace to instantiate the function it calls).
; electron-builder passes these to makensis with /D, so they exist from the very start of
; the real build. Mirrored here or installer.nsh fails to compile in the harness only.
!define UNINSTALL_APP_KEY "00000000-0000-0000-0000-000000000000"
Name "nsis-lint"
OutFile "out_installer.exe"
!include "../installer.nsh"
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "s"
!insertmacro customInstall
SectionEnd
