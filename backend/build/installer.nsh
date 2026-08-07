; Four custom NSIS pages (some conditionally skipped via Abort-in-Create — the standard NSIS
; pattern for a page that decides at runtime whether to render), all writing into
; %APPDATA%\Wentox\app-config.json, which backend/src/config/appConfig.js reads at runtime:
;   1. Setup mode — detects an existing SQL Server (registry check). If found, skipped entirely
;      (falls through to manual entry, page 3). If not found, offers a choice: auto-install SQL
;      Server Express, or manual entry.
;   2. Auto password — only shown if mode is AUTO. One password field, used as SQL Server's `sa`
;      password; server/port/db/user get fixed defaults (localhost/1433/Wentox_db/sa).
;   3. DB connection (manual) — only shown if mode is MANUAL (either chosen, or an existing SQL
;      Server was detected). Full server/port/database/username/password form, as before.
;   4. Backup folder — where the live backup database's data/log files should live. Always shown.
; The install location itself stays fixed (nsis.allowToChangeInstallationDirectory: false in
; package.json) — these pages are the only things the installer lets the user choose.
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
; the change-directory page. There is no customPageBeforeInstall hook. Verified locally with a
; harness that compiles both passes exactly as electron-builder does — see build/lint-nsis.sh.)
!ifndef BUILD_UNINSTALLER

; WordFunc's ${WordReplace} is only a *call* macro — the function it calls has to be instantiated
; explicitly, or linking fails with an undefined-function error. It emits a Function, so it belongs
; inside this guard too: customInstall (its only caller) isn't inserted in the uninstaller pass, so
; instantiating it there would trip the exact same warning 6010.
!insertmacro WordReplace

Var SqlServerDetected ; "1"/"0" — set once by SetupModePageCreate
Var SqlSetupMode       ; "AUTO" or "MANUAL" — decides which of pages 2/3 actually renders
Var RadioAuto
Var RadioManual

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
  Page custom SetupModePageCreate SetupModePageLeave
  Page custom AutoPasswordPageCreate AutoPasswordPageLeave
  Page custom DbConnectionPageCreate DbConnectionPageLeave
  Page custom BackupPathPageCreate BackupPathPageLeave
!macroend

; Registry key that exists once any SQL Server instance is registered, regardless of edition/name.
; SetRegView 64 first: SQL Server registers under the 64-bit hive, and NSIS defaults to the 32-bit
; (WOW6432Node-redirected) view since it's a 32-bit process, which would otherwise never find it.
Function SetupModePageCreate
  SetRegView 64
  ClearErrors
  EnumRegValue $0 HKLM "SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL" 0
  ${IfNot} ${Errors}
    StrCpy $SqlServerDetected "1"
    StrCpy $SqlSetupMode "MANUAL"
    Abort ; skip this page — falls through to page 3 (manual entry), page 2 self-skips too
  ${EndIf}
  StrCpy $SqlServerDetected "0"

  !insertmacro MUI_HEADER_TEXT "SQL Server Setup" "Choose how Wentox should connect to a database."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Wentox needs a SQL Server database. No existing SQL Server installation was found on this PC."
  Pop $0

  ${NSD_CreateRadioButton} 0 30u 100% 12u "Install SQL Server Express automatically (recommended)"
  Pop $RadioAuto
  ${NSD_Check} $RadioAuto

  ${NSD_CreateRadioButton} 0 46u 100% 12u "I already have SQL Server installed elsewhere"
  Pop $RadioManual

  nsDialogs::Show
FunctionEnd

Function SetupModePageLeave
  ${NSD_GetState} $RadioAuto $0
  ${If} $0 == 1 ; BST_CHECKED — hardcoded like ES_PASSWORD elsewhere in this file, not predefined by nsDialogs.nsh
    StrCpy $SqlSetupMode "AUTO"
  ${Else}
    StrCpy $SqlSetupMode "MANUAL"
  ${EndIf}
FunctionEnd

Function AutoPasswordPageCreate
  ${If} $SqlSetupMode != "AUTO"
    Abort ; MANUAL was chosen (or an existing SQL Server was detected) — page 3 handles it instead
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "SQL Server Password" "Choose a password for the database administrator account."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 32u "Wentox will install SQL Server Express automatically. Choose a password for its 'sa' administrator account — used only by Wentox itself to connect to the database, never shown or asked for again:"
  Pop $0

  ${NSD_CreateLabel} 0 40u 30% 12u "Password"
  Pop $0
  ${NSD_CreateText} 32% 38u 68% 12u ""
  Pop $DbPasswordText
  ${NSD_AddStyle} $DbPasswordText 0x0020 ; ES_PASSWORD

  nsDialogs::Show
FunctionEnd

Function AutoPasswordPageLeave
  ${NSD_GetText} $DbPasswordText $DbPasswordValue
  ${If} $DbPasswordValue == ""
    MessageBox MB_ICONEXCLAMATION "Please choose a password."
    Abort
  ${EndIf}
  StrCpy $DbServerValue "localhost"
  StrCpy $DbPortValue "1433"
  StrCpy $DbNameValue "Wentox_db"
  StrCpy $DbUserValue "sa"
FunctionEnd

Function DbConnectionPageCreate
  ${If} $SqlSetupMode == "AUTO"
    Abort ; page 2 (AutoPasswordPage) already collected everything needed for this mode
  ${EndIf}

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

  ; $SqlSetupMode is only ever "AUTO" when SetupModePageCreate found no existing SQL Server (see
  ; that function) — never reinstalls over one that's already there.
  ${If} $SqlSetupMode == "AUTO"
    ; package.json's extraResources copies this in at the same "resources/" location the packaged
    ; app itself reads other bundled files from (frontend/dist, database/schema.sql) via
    ; process.resourcesPath — $INSTDIR\resources is the installed-app equivalent of that.
    ${If} ${FileExists} "$INSTDIR\resources\sqlserver\SQLEXPR_x64_ENU.exe"
      DetailPrint "Installing SQL Server Express - this can take 5-15 minutes, please wait..."
      ; Default (not named) instance so it lands on port 1433 with no further config needed; mixed
      ; SQL Server + Windows auth so the sa/password combo the app was given actually works; TCP/IP
      ; on from the start — all three were manual troubleshooting steps before this existed.
      ExecWait '"$INSTDIR\resources\sqlserver\SQLEXPR_x64_ENU.exe" /Q /ACTION=Install /FEATURES=SQLENGINE /INSTANCENAME=MSSQLSERVER /SECURITYMODE=SQL /SAPWD="$DbPasswordValue" /SQLSVCACCOUNT="NT AUTHORITY\SYSTEM" /SQLSYSADMINACCOUNTS="BUILTIN\Administrators" /TCPENABLED=1 /IACCEPTSQLSERVERLICENSETERMS /UPDATEENABLED=0' $0
      ${If} $0 != 0
        MessageBox MB_ICONEXCLAMATION "SQL Server Express setup exited with code $0. Wentox may not be able to connect until SQL Server is installed or configured manually — see Settings for the connection details to fix by hand if needed."
      ${Else}
        DetailPrint "SQL Server Express installed successfully."
        Sleep 5000 ; give the service a moment to finish starting before Wentox's own first-launch migrate attempts to connect
      ${EndIf}
    ${Else}
      MessageBox MB_ICONEXCLAMATION "The bundled SQL Server Express installer is missing from this package. Wentox will not be able to connect until SQL Server is installed manually."
    ${EndIf}
  ${EndIf}

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
