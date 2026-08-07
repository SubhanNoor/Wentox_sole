; Custom NSIS page: asks where the backup database's data/log files should live. The install
; location itself stays fixed (nsis.allowToChangeInstallationDirectory: false in package.json) —
; this is the ONE thing the installer lets the user choose, per explicit requirement. The chosen
; path is written to %APPDATA%\Wentox\backup-config.json, which
; backend/src/config/appConfig.js#getBackupDbFolder() reads at runtime.
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WordFunc.nsh"

Var BackupPathPage
Var BackupPathText
Var BackupPathValue

; customPageAfterChangeDir is only inserted when nsis.allowToChangeInstallationDirectory is true —
; it's tied to the "change install dir" page, which we deliberately disabled (fixed install path).
; customPageBeforeInstall is electron-builder's unconditional hook, always inserted right before
; the InstFiles page regardless of the directory-page setting, so this page reliably shows.
!macro customPageBeforeInstall
  Page custom BackupPathPageCreate BackupPathPageLeave
!macroend

Function BackupPathPageCreate
  !insertmacro MUI_HEADER_TEXT "Backup Database Location" "Choose where Wentox should keep its backup database."

  nsDialogs::Create 1018
  Pop $BackupPathPage
  ${If} $BackupPathPage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Wentox keeps a second, live backup copy of the database in case the main one is ever lost. Choose the folder its files should live in:"
  Pop $0

  ${If} $BackupPathValue == ""
    StrCpy $BackupPathValue "$DOCUMENTS\Wentox Backup"
  ${EndIf}

  ${NSD_CreateText} 0 30u 70% 12u "$BackupPathValue"
  Pop $BackupPathText

  ${NSD_CreateBrowseButton} 72% 30u 28% 12u "Browse..."
  Pop $1
  ${NSD_OnClick} $1 BackupPathBrowse

  nsDialogs::Show
FunctionEnd

Function BackupPathBrowse
  ${NSD_GetText} $BackupPathText $BackupPathValue
  nsDialogs::SelectFolderDialog "Select Backup Database Folder" "$BackupPathValue"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $BackupPathText "$0"
  ${EndIf}
FunctionEnd

Function BackupPathPageLeave
  ${NSD_GetText} $BackupPathText $BackupPathValue
  ${If} $BackupPathValue == ""
    MessageBox MB_ICONEXCLAMATION "Please choose a backup database folder."
    Abort
  ${EndIf}
FunctionEnd

!macro customInstall
  CreateDirectory "$APPDATA\Wentox"
  CreateDirectory "$BackupPathValue"
  ; JSON needs forward slashes (or doubled backslashes) — Node's fs/path accept forward slashes on
  ; Windows fine, so converting is simpler than escaping.
  ${WordReplace} "$BackupPathValue" "\" "/" "+" $5
  FileOpen $4 "$APPDATA\Wentox\backup-config.json" w
  FileWrite $4 '{"backupDbFolder": "$5"}'
  FileClose $4
!macroend
