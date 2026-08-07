; Harness reproducing electron-builder's SECOND makensis pass — the real installer, where both
; customPageAfterChangeDir and customInstall are inserted. Verifies the custom pages actually
; compile and that every function/macro they reference resolves (e.g. WordFunc's ${WordReplace},
; which needs an explicit !insertmacro WordReplace to instantiate the function it calls).
Name "nsis-lint"
OutFile "out_installer.exe"
!include "../installer.nsh"
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "s"
!insertmacro customInstall
SectionEnd
