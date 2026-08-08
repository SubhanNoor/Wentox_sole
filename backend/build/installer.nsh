; ONE custom page: a database password and a backup folder. That's everything the user is asked
; for — build/setup-sqlserver.ps1 handles the rest (installing SQL Server Express if absent,
; enabling mixed-mode auth, pinning TCP to 1433, enabling sa with this password, creating the
; database, then verifying the connection actually works).
;
; Why only a password: whatever state SQL Server is in, the script forces sa to the password given
; here (over Windows auth, which always works for a local admin), so server/port/database/user are
; always localhost/1433/Wentox_db/sa and there is nothing else worth asking. Earlier versions asked
; for a full connection form and a "do you already have SQL Server?" choice; both were noise, and
; the manual form couldn't work anyway while sa stayed disabled.
;
; A remote/non-standard SQL Server is still possible after install by editing
; %APPDATA%\Wentox\app-config.json, which is the same file this page writes.
;
; The install location itself stays fixed (nsis.allowToChangeInstallationDirectory: false).
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
; ... not referenced or never set" — which electron-builder makes fatal by passing -WX. Vars matter
; as much as Functions here: 6001 is just as fatal as 6010.
;
; (customPageAfterChangeDir IS the right hook and is inserted regardless of
; allowToChangeInstallationDirectory — that !ifmacrodef block sits after/outside the !ifdef for
; the change-directory page. There is no customPageBeforeInstall hook. Verified locally with a
; harness that compiles both passes exactly as electron-builder does — see build/lint-nsis.sh.)
!ifndef BUILD_UNINSTALLER

; WordFunc's ${WordReplace} is only a *call* macro — the function it calls has to be instantiated
; explicitly, or linking fails with an undefined-function error. It emits a Function, so it belongs
; inside this guard too.
!insertmacro WordReplace

Var DbPasswordText
Var DbPasswordConfirmText
Var DbPasswordValue

Var BackupPathText
Var BackupPathValue

!macro customPageAfterChangeDir
  Page custom SetupPageCreate SetupPageLeave
!macroend

Function SetupPageCreate
  !insertmacro MUI_HEADER_TEXT "Database Setup" "Choose a database password and a backup location."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 32u "Wentox will set up its database automatically, installing SQL Server Express if this PC doesn't already have it. Choose a password for the database administrator account - Wentox uses it internally to connect, and you won't be asked for it again."
  Pop $0

  ${NSD_CreateLabel} 0 40u 32% 12u "Database password"
  Pop $0
  ${NSD_CreateText} 34% 38u 66% 12u ""
  Pop $DbPasswordText
  ${NSD_AddStyle} $DbPasswordText 0x0020 ; ES_PASSWORD — masks input; not predefined by nsDialogs.nsh

  ${NSD_CreateLabel} 0 56u 32% 12u "Confirm password"
  Pop $0
  ${NSD_CreateText} 34% 54u 66% 12u ""
  Pop $DbPasswordConfirmText
  ${NSD_AddStyle} $DbPasswordConfirmText 0x0020

  ${NSD_CreateLabel} 0 78u 100% 24u "Wentox also keeps a second, live backup copy of the database in case the main one is ever lost. Choose the folder its files should live in:"
  Pop $0

  ${If} $BackupPathValue == ""
    StrCpy $BackupPathValue "$DOCUMENTS\Wentox Backup"
  ${EndIf}

  ${NSD_CreateText} 0 104u 70% 12u "$BackupPathValue"
  Pop $BackupPathText

  ${NSD_CreateBrowseButton} 72% 104u 28% 12u "Browse..."
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
  ${NSD_GetText} $DbPasswordText $DbPasswordValue
  ${NSD_GetText} $DbPasswordConfirmText $1
  ${NSD_GetText} $BackupPathText $BackupPathValue

  ${If} $DbPasswordValue == ""
    MessageBox MB_ICONEXCLAMATION "Please choose a database password."
    Abort
  ${EndIf}
  ${If} $DbPasswordValue != $1
    MessageBox MB_ICONEXCLAMATION "The two passwords do not match."
    Abort
  ${EndIf}
  ; SQL Server setup takes this password on a command line that has no way to escape a double
  ; quote — rejected here with a clear reason rather than failing later with an opaque code.
  ${WordFind} "$DbPasswordValue" '"' "E+1{" $2
  ${IfNot} ${Errors}
    MessageBox MB_ICONEXCLAMATION "The password cannot contain a double-quote character."
    Abort
  ${EndIf}
  ClearErrors
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
; itself doesn't get re-escaped), then double-quote.
!macro JsonEscape Input Output
  ${WordReplace} "${Input}" "\" "\\" "+" ${Output}
  ${WordReplace} "${Output}" '"' '\"' "+" ${Output}
!macroend

!macro customInstall
  ; This runs inside electron-builder's own install Section (installSection.nsh), so the scratch
  ; registers we use here are not ours to trash — save and restore them.
  Push $3
  Push $4
  Push $5
  Push $9

  CreateDirectory "$APPDATA\Wentox"
  CreateDirectory "$BackupPathValue"

  ${If} ${FileExists} "$INSTDIR\resources\setup-sqlserver.ps1"
    DetailPrint "Setting up the database - this can take several minutes, please wait..."
    ; Password goes via a file in $PLUGINSDIR (auto-wiped when the installer exits) rather than the
    ; command line, so it never lands in the process list and NSIS doesn't have to escape quotes.
    FileOpen $4 "$PLUGINSDIR\sapwd.txt" w
    FileWrite $4 "$DbPasswordValue"
    FileClose $4

    ; NSIS is a 32-bit process, so a bare "powershell.exe" is WOW64-redirected to the 32-bit
    ; PowerShell in SysWOW64 — which sees the WOW6432Node registry view, where SQL Server is not
    ; registered at all. $WINDIR\Sysnative is the alias letting a 32-bit process reach the real
    ; 64-bit System32. (The script also forces a Registry64 view, so it stays correct regardless.)
    StrCpy $3 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${IfNot} ${FileExists} "$3"
      StrCpy $3 "powershell.exe" ; genuinely 32-bit Windows, or Sysnative unavailable
    ${EndIf}

    ExecWait '"$3" -ExecutionPolicy Bypass -NoProfile -File "$INSTDIR\resources\setup-sqlserver.ps1" -PasswordFile "$PLUGINSDIR\sapwd.txt" -InstallerPath "$INSTDIR\resources\sqlserver\SQLEXPR_x64_ENU.exe" -LogPath "$INSTDIR\sqlserver-setup.log"' $9
    Delete "$PLUGINSDIR\sapwd.txt"

    ${If} $9 != 0
      MessageBox MB_ICONEXCLAMATION "Database setup did not complete (exit code $9).$\r$\n$\r$\nThe full reason was written to:$\r$\n$INSTDIR\sqlserver-setup.log$\r$\n$\r$\nWentox will still install; you can re-run the setup step later once the problem is resolved."
    ${Else}
      DetailPrint "Database ready."
    ${EndIf}
  ${EndIf}

  ; Fixed values on purpose — setup-sqlserver.ps1 guarantees exactly this combination works, so
  ; there is nothing here the user needed to be asked for beyond the password itself.
  !insertmacro JsonEscape "$DbPasswordValue" $5
  ; JSON needs forward slashes (or doubled backslashes) — Node's fs/path accept forward slashes on
  ; Windows fine, so converting is simpler than escaping for the folder path.
  ${WordReplace} "$BackupPathValue" "\" "/" "+" $4

  FileOpen $3 "$APPDATA\Wentox\app-config.json" w
  FileWrite $3 '{"dbServer": "localhost", "dbPort": "1433", "dbName": "Wentox_db", "dbUser": "sa", "dbPassword": "$5", "backupDbFolder": "$4"}'
  FileClose $3

  Pop $9
  Pop $5
  Pop $4
  Pop $3
!macroend
