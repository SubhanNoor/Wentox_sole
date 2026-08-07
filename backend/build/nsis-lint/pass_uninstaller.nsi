; Harness reproducing electron-builder's FIRST makensis pass, where BUILD_UNINSTALLER is defined
; (installer.nsi is compiled twice — once to emit the uninstaller, once for the real installer).
;
; In this pass electron-builder does NOT insert customPageAfterChangeDir (guarded by
; !ifndef BUILD_UNINSTALLER in assistedInstaller.nsh) or customInstall (installSection.nsh is
; likewise only included in the other pass). So anything installer.nsh declares unconditionally —
; a Function or a Var — ends up orphaned here and makensis warns (6010 / 6001). electron-builder
; passes -WX, so those warnings are fatal. This pass exists to catch exactly that.
!define BUILD_UNINSTALLER
Name "nsis-lint"
OutFile "out_uninstaller.exe"
!include "../installer.nsh"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "s"
SectionEnd
