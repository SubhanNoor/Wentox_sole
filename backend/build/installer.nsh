; One custom NSIS page (both a DB connection form AND a backup folder picker on it — merged into a
; single page after two separate `Page custom` calls in one macro turned out to only register one
; of them with NSIS's compiler, "install function ... not referenced", which electron-builder
; treats as a fatal warning) that writes into %APPDATA%\Wentox\app-config.json, which
; backend/src/config/appConfig.js reads at runtime:
;   - DB connection fields — the packaged app never ships `.env` (dev-only, and shouldn't carry a
;     real shop PC's SQL Server password into git anyway), so this is how a packaged install
;     learns its SQL Server details. backend/src/config/index.js falls back to `.env` only when
;     this file doesn't exist, i.e. on a dev checkout — nothing here affects local dev.
;   - Backup folder field — where the live backup database's data/log files should live. The
;     install location itself stays fixed (nsis.allowToChangeInstallationDirectory: false in
;     package.json); this page is the only thing the installer lets the user choose.
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WordFunc.nsh"
; MUI_HEADER_TEXT is a MUI2 macro — electron-builder's base template includes MUI2.nsh itself, but
; this file gets !include-d before that happens, so the macro isn't defined yet when NSIS compiles
; this script (a build-time, not runtime, ordering problem). MUI2.nsh has its own include guard,
; so including it again here is safe.
!include "MUI2.nsh"

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

Var BackupPathText
Var BackupPathValue

; customPageAfterChangeDir is only inserted when nsis.allowToChangeInstallationDirectory is true —
; it's tied to the "change install dir" page, which we deliberately disabled (fixed install path).
; customPageBeforeInstall is electron-builder's unconditional hook, always inserted right before
; the InstFiles page regardless of the directory-page setting, so this page reliably shows.
!macro customPageBeforeInstall
  Page custom SetupPageCreate SetupPageLeave
!macroend

Function SetupPageCreate
  !insertmacro MUI_HEADER_TEXT "Database Setup" "Enter the SQL Server connection and choose a backup location."

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

  ${NSD_CreateLabel} 0 20u 30% 12u "Server"
  Pop $0
  ${NSD_CreateText} 32% 18u 68% 12u "$DbServerValue"
  Pop $DbServerText

  ${NSD_CreateLabel} 0 36u 30% 12u "Port"
  Pop $0
  ${NSD_CreateText} 32% 34u 68% 12u "$DbPortValue"
  Pop $DbPortText

  ${NSD_CreateLabel} 0 52u 30% 12u "Database Name"
  Pop $0
  ${NSD_CreateText} 32% 50u 68% 12u "$DbNameValue"
  Pop $DbNameText

  ${NSD_CreateLabel} 0 68u 30% 12u "Username"
  Pop $0
  ${NSD_CreateText} 32% 66u 68% 12u "$DbUserValue"
  Pop $DbUserText

  ${NSD_CreateLabel} 0 84u 30% 12u "Password"
  Pop $0
  ${NSD_CreateText} 32% 82u 68% 12u "$DbPasswordValue"
  Pop $DbPasswordText
  ${NSD_AddStyle} $DbPasswordText 0x0020 ; ES_PASSWORD — masks the input; not predefined by nsDialogs.nsh, so hardcoded

  ${NSD_CreateLabel} 0 106u 100% 24u "Wentox keeps a second, live backup copy of the database in case the main one is ever lost. Choose the folder its files should live in:"
  Pop $0

  ${If} $BackupPathValue == ""
    StrCpy $BackupPathValue "$DOCUMENTS\Wentox Backup"
  ${EndIf}

  ${NSD_CreateText} 0 132u 70% 12u "$BackupPathValue"
  Pop $BackupPathText

  ${NSD_CreateBrowseButton} 72% 132u 28% 12u "Browse..."
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

Function SetupPageLeave
  ${NSD_GetText} $DbServerText $DbServerValue
  ${NSD_GetText} $DbPortText $DbPortValue
  ${NSD_GetText} $DbNameText $DbNameValue
  ${NSD_GetText} $DbUserText $DbUserValue
  ${NSD_GetText} $DbPasswordText $DbPasswordValue
  ${NSD_GetText} $BackupPathText $BackupPathValue

  ${If} $DbServerValue == ""
  ${OrIf} $DbNameValue == ""
  ${OrIf} $DbUserValue == ""
    MessageBox MB_ICONEXCLAMATION "Please fill in the server, database name, and username."
    Abort
  ${EndIf}

  ${If} $BackupPathValue == ""
    MessageBox MB_ICONEXCLAMATION "Please choose a backup database folder."
    Abort
  ${EndIf}
FunctionEnd

; Escapes a value for safe embedding in a JSON string: backslash first (so the escaping backslash
; itself doesn't get re-escaped), then double-quote. Needed for the password field especially —
; server/db/user are unlikely to contain either, but there's no reason not to be defensive here too.
!macro JsonEscape Input Output
  ${WordReplace} "${Input}" "\" "\\" "+" ${Output}
  ${WordReplace} "${Output}" '"' '\"' "+" ${Output}
!macroend

!macro customInstall
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
!macroend
