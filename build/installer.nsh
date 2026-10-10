!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  ; The stock PowerShell branch only searches $INSTDIR. An old installation
  ; elsewhere can keep the single-instance lock and reopen after an upgrade.
  ; Use the stock exact executable-name check, scoped to the current user.
  Var /GLOBAL IsPowerShellAvailable
  StrCpy $IsPowerShellAvailable 1
  ; Cancelled or blocked upgrades must not report a successful installation.
  SetErrorLevel 2
  !insertmacro _CHECK_APP_RUNNING
  SetErrorLevel 0
!macroend

!macro customInstall
  ; Refresh existing links even when the updater preserves shortcuts.
  ; Missing links stay missing if the user removed them.
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endif}
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
    ${andIf} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endif}
  !endif
!macroend
