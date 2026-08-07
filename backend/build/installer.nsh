; Two custom NSIS pages, both write into %APPDATA%\Wentox\app-config.json, which
; backend/src/config/appConfig.js reads at runtime:
;   1. DB connection page — the packaged app never ships `.env` (dev-only, and shouldn't carry a
;      real shop PC's SQL Server password into git anyway), so this is how a packaged install
;      learns its SQL Server details. backend/src/config/index.js falls back to `.env` only when
;      this file doesn't exist, i.e. on a dev checkout — nothing here affects local dev.
;   2. Backup folder page — where the live backup database's data/log files should live. The
;      install location itself stays fixed (nsis.allowToChangeInstallationDirectory: false in
;      package.json); these two pages are the only things the installer lets the user choose.
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WordFunc.nsh"
; MUI_HEADER_TEXT is a MUI2 macro — electron-builder's base template includes MUI2.nsh itself, but
; this file gets !include-d before that happens, so the macro isn't defined yet when NSIS compiles
; this script (a build-time, not runtime, ordering problem). MUI2.nsh has its own include guard,
; so including it again here is safe.
!include "MUI2.nsh"

; ---------------------------------------------------------------------------------------------
; EVERYTHING that emits a Function OR declares a Var must live inside this guard.
;
; electron-builder compiles installer.nsi TWICE: once with BUILD_UNINSTALLER defined (to emit the
; uninstaller executable), then again for the real installer. This file is !include-d in BOTH
; passes, but the hooks that reference our functions are not:
;   - assistedInstaller.nsh:7 wraps the whole page block (incl. !insertmacro
;     customPageAfterChangeDir) in !ifndef BUILD_UNINSTALLER
;   - installer.nsi:115 only !include-s installSection.nsh (which inserts customInstall) inside
;     that same guard
; So in the uninstaller pass our page functions/vars would compile with nothing referencing them,
; and makensis emits "warning 6010: install function ... not referenced" / "warning 6001: Variable
; ... not referenced or never set" — which electron-builder makes fatal by passing -WX. Guarding
; them here means the uninstaller pass sees neither. Vars matter as much as Functions here: 6001
; is just as fatal as 6010.
;
; (customPageAfterChangeDir IS the right hook and is inserted regardless of
; allowToChangeInstallationDirectory — that !ifmacrodef block sits after/outside the !ifdef for
; the change-directory page. There is no customPageBeforeInstall hook.)
!ifndef BUILD_UNINSTALLER

; WordFunc's ${WordReplace} is only a *call* macro — the function it calls has to be instantiated
; explicitly, or linking fails with an undefined-function error. It emits a Function, so it belongs
; inside this guard too: customInstall (its only caller) isn't inserted in the uninstaller pass, so
; instantiating it there would trip the exact same warning 6010.
!insertmacro WordReplace

Var DbServerText
Var DbPortText
Var DbNameText
Var DbUserText
Var DbPasswordText
Var DbServerValue
Var DbPortValue
Var DbNameValue
Var DbUserValue
Var DbPasswordValue

Var BackupPathPage
Var BackupPathText
Var BackupPathValue

!macro customPageAfterChangeDir
  Page custom DbConnectionPageCreate DbConnectionPageLeave
  Page custom BackupPathPageCreate BackupPathPageLeave
!macroend

Function DbConnectionPageCreate
  !insertmacro MUI_HEADER_TEXT "Database Connection" "Enter the SQL Server this PC will use for Wentox."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 16u "SQL Server must already be installed on this PC. Enter its connection details:"
  Pop $0

  ${If} $DbServerValue == ""
    StrCpy $DbServerValue "localhost"
  ${EndIf}
  ${If} $DbPortValue == ""
    StrCpy $DbPortValue "1433"
  ${EndIf}
  ${If} $DbNameValue == ""
    StrCpy $DbNameValue "Wentox_db"
  ${EndIf}
  ${If} $DbUserValue == ""
    StrCpy $DbUserValue "sa"
  ${EndIf}

  ${NSD_CreateLabel} 0 22u 30% 12u "Server"
  Pop $0
  ${NSD_CreateText} 32% 20u 68% 12u "$DbServerValue"
  Pop $DbServerText

  ${NSD_CreateLabel} 0 38u 30% 12u "Port"
  Pop $0
  ${NSD_CreateText} 32% 36u 68% 12u "$DbPortValue"
  Pop $DbPortText

  ${NSD_CreateLabel} 0 54u 30% 12u "Database Name"
  Pop $0
  ${NSD_CreateText} 32% 52u 68% 12u "$DbNameValue"
  Pop $DbNameText

  ${NSD_CreateLabel} 0 70u 30% 12u "Username"
  Pop $0
  ${NSD_CreateText} 32% 68u 68% 12u "$DbUserValue"
  Pop $DbUserText

  ${NSD_CreateLabel} 0 86u 30% 12u "Password"
  Pop $0
  ${NSD_CreateText} 32% 84u 68% 12u "$DbPasswordValue"
  Pop $DbPasswordText
  ${NSD_AddStyle} $DbPasswordText 0x0020 ; ES_PASSWORD — masks the input; not predefined by nsDialogs.nsh, so hardcoded

  nsDialogs::Show
FunctionEnd

Function DbConnectionPageLeave
  ${NSD_GetText} $DbServerText $DbServerValue
  ${NSD_GetText} $DbPortText $DbPortValue
  ${NSD_GetText} $DbNameText $DbNameValue
  ${NSD_GetText} $DbUserText $DbUserValue
  ${NSD_GetText} $DbPasswordText $DbPasswordValue

  ${If} $DbServerValue == ""
  ${OrIf} $DbNameValue == ""
  ${OrIf} $DbUserValue == ""
    MessageBox MB_ICONEXCLAMATION "Please fill in the server, database name, and username."
    Abort
  ${EndIf}
FunctionEnd

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

!endif ; BUILD_UNINSTALLER

; Macros below emit no code unless inserted, so they're safe to define in both passes.
; customInstall is only inserted by installSection.nsh, which is itself installer-pass-only.
;
; Escapes a value for safe embedding in a JSON string: backslash first (so the escaping backslash
; itself doesn't get re-escaped), then double-quote. Needed for the password field especially —
; server/db/user are unlikely to contain either, but there's no reason not to be defensive here too.
!macro JsonEscape Input Output
  ${WordReplace} "${Input}" "\" "\\" "+" ${Output}
  ${WordReplace} "${Output}" '"' '\"' "+" ${Output}
!macroend

!macro customInstall
  ; This runs inside electron-builder's own install Section (installSection.nsh), so the scratch
  ; registers we use here are not ours to trash — save and restore them.
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9

  CreateDirectory "$APPDATA\Wentox"
  CreateDirectory "$BackupPathValue"

  !insertmacro JsonEscape "$DbServerValue" $6
  !insertmacro JsonEscape "$DbNameValue" $7
  !insertmacro JsonEscape "$DbUserValue" $8
  !insertmacro JsonEscape "$DbPasswordValue" $9
  ; JSON needs forward slashes (or doubled backslashes) — Node's fs/path accept forward slashes on
  ; Windows fine, so converting is simpler than escaping for the folder path specifically.
  ${WordReplace} "$BackupPathValue" "\" "/" "+" $5

  FileOpen $4 "$APPDATA\Wentox\app-config.json" w
  FileWrite $4 '{"dbServer": "$6", "dbPort": "$DbPortValue", "dbName": "$7", "dbUser": "$8", "dbPassword": "$9", "backupDbFolder": "$5"}'
  FileClose $4

  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
!macroend
