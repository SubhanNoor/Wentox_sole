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

; "1" once the setup page has actually been shown and filled in. customInstall uses this to tell a
; FRESH install (use what the user just typed) from an UPDATE (reuse the saved config silently).
Var AskedUser

!macro customPageAfterChangeDir
  Page custom SetupPageCreate SetupPageLeave
!macroend

Function SetupPageCreate
  ; An UPDATE (electron-updater re-runs this installer over the existing one) must not ask for the
  ; password and backup folder again — they're already set and already work.
  ;
  ; The signal is whether the app is CURRENTLY INSTALLED, i.e. its uninstall registry key exists.
  ; Not the config file: uninstalling Wentox deliberately leaves %ProgramData%\Wentox\app-config.json
  ; behind (so settings survive a reinstall), so keying off that made a genuine
  ; uninstall-then-reinstall silently skip setup with no way to change the password — which is
  ; exactly what happened. This key is written by the install section, which runs AFTER this page,
  ; so on a fresh install it is reliably absent here even though the same run creates it later.
  ; ${UNINSTALL_APP_KEY} is a command-line define, available this early; HKLM because perMachine.
  ;
  ; BOTH conditions are required, and getting this wrong broke a real install: the page may only
  ; be skipped when there are actually settings to fall back on. Keyed on the uninstall key alone,
  ; deleting app-config.json while the app stayed installed skipped the page (nothing asked) AND
  ; left the script with no password to reuse — it exited 1 and no database was set up. Asking
  ; whenever the config is missing keeps the page's decision and the script's password source in
  ; agreement, whichever way the machine got into that state.
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  ReadEnvStr $R1 "ProgramData"
  ${If} $R0 != ""
  ${AndIf} ${FileExists} "$R1\Wentox\app-config.json"
    Abort ; installed AND configured -> update/repair, keep every existing setting
  ${EndIf}

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
  StrCpy $AskedUser "1" ; reached only on a fresh install, once the page validates
FunctionEnd

!endif ; BUILD_UNINSTALLER

; Macros below emit no code unless inserted, so they're safe to define in both passes.
; customInstall is only inserted by installSection.nsh, which is itself installer-pass-only.
;
; NOTE: app-config.json is deliberately NOT written here any more. It used to be, using a
; hand-rolled JSON escape built on ${WordReplace} — which produced a config whose password did not
; match the one actually set on sa, so setup verified successfully and the app still failed with
; ELOGIN. setup-sqlserver.ps1 writes it instead: it holds the exact password it verifies, and
; ConvertTo-Json escapes correctly by construction.
!macro customInstall
  ; This runs inside electron-builder's own install Section (installSection.nsh), so the scratch
  ; registers we use here are not ours to trash — save and restore them.
  Push $3
  Push $4
  Push $9
  Push $R1

  ${If} ${FileExists} "$INSTDIR\resources\setup-sqlserver.ps1"
    ; The script runs on EVERY install, update included — it is idempotent, and this is what makes
    ; an update also verify/repair the database rather than assume it's fine. Skipping it entirely
    ; on update meant a machine whose SQL Server was missing or misconfigured could never be fixed
    ; by reinstalling, which is a state this project has actually been in.
    ;
    ; The difference is only WHERE the answers come from. $AskedUser is set by the setup page,
    ; which runs only on a fresh install:
    ;   fresh  -> pass the password/backup folder the user just entered
    ;   update -> pass neither; the script reads both back out of the existing config
    ; A silent install (pages never run) therefore takes the update path, which is correct: it has
    ; no answers to use and must not overwrite a working config with empty ones.
    StrCpy $R1 "" ; extra args
    ${If} $AskedUser == "1"
      DetailPrint "Setting up the database - this can take several minutes, please wait..."
      ; Password goes via a file in $PLUGINSDIR (auto-wiped when the installer exits) rather than
      ; the command line, so it never lands in the process list and NSIS doesn't have to escape
      ; quotes into a command string.
      FileOpen $4 "$PLUGINSDIR\sapwd.txt" w
      FileWrite $4 "$DbPasswordValue"
      FileClose $4
      StrCpy $R1 '-PasswordFile "$PLUGINSDIR\sapwd.txt" -BackupFolder "$BackupPathValue"'
    ${Else}
      DetailPrint "Verifying the database using your existing settings..."
    ${EndIf}

    ; NSIS is a 32-bit process, so a bare "powershell.exe" is WOW64-redirected to the 32-bit
    ; PowerShell in SysWOW64 — which sees the WOW6432Node registry view, where SQL Server is not
    ; registered at all. $WINDIR\Sysnative is the alias letting a 32-bit process reach the real
    ; 64-bit System32. (The script also forces a Registry64 view, so it stays correct regardless.)
    StrCpy $3 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${IfNot} ${FileExists} "$3"
      StrCpy $3 "powershell.exe" ; genuinely 32-bit Windows, or Sysnative unavailable
    ${EndIf}

    ; The script also writes the app config (see the note above customInstall), up-front before any
    ; install work, so the app has valid settings even if SQL Server setup itself fails.
    ; -ConfigPath is deliberately NOT passed: the script defaults to %ProgramData%\Wentox, and
    ; NSIS's own $APPDATA is unreliable here — electron-builder sets the all-users shell context for
    ; a perMachine install, so $APPDATA silently means C:\ProgramData in some places and the user's
    ; roaming folder in others. Letting the script resolve it from $env:ProgramData is unambiguous.
    ExecWait '"$3" -ExecutionPolicy Bypass -NoProfile -File "$INSTDIR\resources\setup-sqlserver.ps1" $R1 -InstallerPath "$INSTDIR\resources\sqlserver\SQLEXPR_x64_ENU.exe" -LogPath "$INSTDIR\sqlserver-setup.log"' $9
    Delete "$PLUGINSDIR\sapwd.txt"

    ${If} $9 != 0
      MessageBox MB_ICONEXCLAMATION "Database setup did not complete (exit code $9).$\r$\n$\r$\nThe full reason was written to:$\r$\n$INSTDIR\sqlserver-setup.log$\r$\n$\r$\nWentox will still install; you can re-run the setup step later once the problem is resolved."
    ${Else}
      DetailPrint "Database ready."
    ${EndIf}
  ${EndIf}

  Pop $R1
  Pop $9
  Pop $4
  Pop $3
!macroend
