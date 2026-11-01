!include "WinVer.nsh"
!macro customInit
  ${IfNot} ${AtLeastWin7}
    MessageBox MB_OK|MB_ICONSTOP "Esta versao do MyDelivery precisa do Windows 7 SP1 ou superior."
    Abort
  ${EndIf}
!macroend
